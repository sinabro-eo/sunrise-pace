// 안드로이드 앱(APK) 안에서만 쓰는 연결부. 웹에서는 아무 일도 하지 않는다.
// build-web.mjs가 이 파일을 묶어 dist/js/native.js로 만들고 index.html에 끼워 넣는다.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

if (Capacitor.isNativePlatform()) {
  window.NativeBridge = {
    geo: registerPlugin('BackgroundGeolocation'),
    notifications: LocalNotifications,
  };
}
