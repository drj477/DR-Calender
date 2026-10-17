Pod::Spec.new do |s|
  s.name           = 'DRCalenderNative'
  s.version        = '1.0.0'
  s.summary        = 'Native alarms and widget bridge for DR Calender'
  s.description    = 'Expo module for platform alarm scheduling and widget snapshot publication.'
  s.author         = 'DR Calender'
  s.homepage       = 'https://github.com/drj477/DR-Calender'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/drj477/DR-Calender.git', :tag => s.version.to_s }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
