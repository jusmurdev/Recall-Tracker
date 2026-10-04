package expo.modules.visionocr

import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * ML Kit text recognition v2 with the bundled Latin model (runs fully on-device, uses the NNAPI
 * delegate on recent SoCs) and bundled barcode scanning. Same result shape as the iOS module.
 */
class VisionOcrModule : Module() {
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
  private val scanner by lazy {
    BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128, Barcode.FORMAT_QR_CODE)
        .build()
    )
  }

  override fun definition() = ModuleDefinition {
    Name("VisionOcr")

    Function("isAvailable") { true }

    AsyncFunction("recognize") { uri: String, _options: Map<String, Any?>?, promise: Promise ->
      val start = System.currentTimeMillis()
      val context = appContext.reactContext ?: throw CodedException("E_CONTEXT", "No React context", null)
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject(CodedException("E_IMAGE", "Could not load image at $uri", e)); return@AsyncFunction
      }
      val width = image.width.toDouble()
      val height = image.height.toDouble()
      recognizer.process(image)
        .addOnSuccessListener { text ->
          val lines = ArrayList<Map<String, Any>>()
          for (block in text.textBlocks) for (line in block.lines) {
            val box = line.boundingBox ?: continue
            lines.add(
              mapOf(
                "text" to line.text,
                "confidence" to (line.confidence?.toDouble() ?: 1.0),
                "box" to mapOf("x" to box.left / width, "y" to box.top / height, "width" to box.width() / width, "height" to box.height() / height),
              )
            )
          }
          lines.sortWith(compareBy({ ((it["box"] as Map<*, *>)["y"] as Double) }, { ((it["box"] as Map<*, *>)["x"] as Double) }))
          promise.resolve(
            mapOf(
              "text" to lines.joinToString("\n") { it["text"] as String },
              "lines" to lines,
              "width" to image.width,
              "height" to image.height,
              "engine" to "mlkit",
              "durationMs" to (System.currentTimeMillis() - start).toDouble(),
            )
          )
        }
        .addOnFailureListener { e -> promise.reject(CodedException("E_OCR", e.message ?: "recognition failed", e)) }
    }

    AsyncFunction("detectBarcodes") { uri: String, promise: Promise ->
      val context = appContext.reactContext ?: throw CodedException("E_CONTEXT", "No React context", null)
      val image = try { InputImage.fromFilePath(context, Uri.parse(uri)) } catch (e: Exception) { promise.resolve(emptyList<Any>()); return@AsyncFunction }
      scanner.process(image)
        .addOnSuccessListener { codes -> promise.resolve(codes.mapNotNull { c -> c.rawValue?.let { mapOf("payload" to it, "symbology" to c.format.toString()) } }) }
        .addOnFailureListener { promise.resolve(emptyList<Any>()) }
    }
  }
}
