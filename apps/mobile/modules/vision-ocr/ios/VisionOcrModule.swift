import ExpoModulesCore
import Vision
import UIKit

/**
 * Apple Vision text recognition. `.accurate` uses the on-device neural recogniser, which runs on
 * the Neural Engine on A12+ devices: a receipt-sized photo takes well under a second on recent
 * iPhones, and nothing leaves the phone. Returns every line with a normalised bounding box so
 * JavaScript can rebuild receipt rows (item on the left, price on the right).
 */
public class VisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionOcr")

    Function("isAvailable") { () -> Bool in
      return true
    }

    AsyncFunction("recognize") { (uri: String, options: [String: Any]?) -> [String: Any] in
      let start = CFAbsoluteTimeGetCurrent()
      guard let cgImage = try VisionOcrModule.loadImage(uri) else {
        throw Exception(name: "E_IMAGE", description: "Could not load image at \(uri)")
      }
      let request = VNRecognizeTextRequest()
      let level = (options?["level"] as? String) ?? "accurate"
      request.recognitionLevel = level == "fast" ? .fast : .accurate
      request.usesLanguageCorrection = (options?["languageCorrection"] as? Bool) ?? true
      if let langs = options?["languages"] as? [String], !langs.isEmpty {
        request.recognitionLanguages = langs
      } else if #available(iOS 16.0, *) {
        request.automaticallyDetectsLanguage = true
      }
      if #available(iOS 16.0, *) {
        request.revision = VNRecognizeTextRequestRevision3
      }
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
      try handler.perform([request])
      let observations = (request.results ?? [])
      var lines: [[String: Any]] = []
      var texts: [String] = []
      for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        // Vision boxes are normalised with origin bottom-left; flip to top-left.
        let b = obs.boundingBox
        lines.append([
          "text": top.string,
          "confidence": Double(top.confidence),
          "box": ["x": Double(b.minX), "y": Double(1 - b.maxY), "width": Double(b.width), "height": Double(b.height)],
        ])
        texts.append(top.string)
      }
      // Vision returns observations in reading order for most layouts; sort by y then x to be safe.
      lines.sort { (a, b) -> Bool in
        let ab = a["box"] as! [String: Double], bb = b["box"] as! [String: Double]
        if abs(ab["y"]! - bb["y"]!) > 0.012 { return ab["y"]! < bb["y"]! }
        return ab["x"]! < bb["x"]!
      }
      let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
      return [
        "text": (lines.map { $0["text"] as! String }).joined(separator: "\n"),
        "lines": lines,
        "width": cgImage.width,
        "height": cgImage.height,
        "engine": "vision",
        "durationMs": ms,
      ]
    }

    AsyncFunction("detectBarcodes") { (uri: String) -> [[String: Any]] in
      guard let cgImage = try VisionOcrModule.loadImage(uri) else { return [] }
      let request = VNDetectBarcodesRequest()
      request.symbologies = [.ean13, .ean8, .upce, .code128, .code39, .qr, .dataMatrix]
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
      try handler.perform([request])
      return (request.results ?? []).compactMap { obs in
        guard let payload = obs.payloadStringValue else { return nil }
        return ["payload": payload, "symbology": obs.symbology.rawValue]
      }
    }
  }

  static func loadImage(_ uri: String) throws -> CGImage? {
    let path = uri.hasPrefix("file://") ? String(uri.dropFirst(7)) : uri
    guard let image = UIImage(contentsOfFile: path.removingPercentEncoding ?? path) else { return nil }
    // Bake EXIF orientation in so Vision sees the photo the way the user did.
    if image.imageOrientation == .up, let cg = image.cgImage { return cg }
    UIGraphicsBeginImageContextWithOptions(image.size, false, 1)
    image.draw(in: CGRect(origin: .zero, size: image.size))
    let normalized = UIGraphicsGetImageFromCurrentImageContext()
    UIGraphicsEndImageContext()
    return normalized?.cgImage
  }
}
