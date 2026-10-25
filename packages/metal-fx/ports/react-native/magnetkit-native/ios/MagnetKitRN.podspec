require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MagnetKitRN'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Jakubantalik/Libraries.dev.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # MagnetKit's Swift sources (copied in by scripts/sync.mjs) and the module.
  # The model, Magnet.mfxl, is the app's: see the config plugin.
  s.source_files = '*.swift', 'MagnetKit/*.swift'
end
