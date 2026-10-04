Pod::Spec.new do |s|
  s.name           = 'VisionOcr'
  s.version        = '1.0.0'
  s.summary        = 'On-device OCR and barcode detection with Apple Vision'
  s.description    = 'Text recognition (VNRecognizeTextRequest, accurate mode, Neural Engine) and barcode detection for Recall Tracker.'
  s.author         = ''
  s.homepage       = 'https://github.com/jusmurdev/recall-tracker'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreImage', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = "**/*.{h,m,swift}"
end
