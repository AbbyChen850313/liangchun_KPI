// ============================================================
// shared/config.js — 環境設定（單一維護點）
//
// 更換 GAS 部署：只改這裡
// 更換 LIFF ID：只改這裡
// ============================================================

const IS_TEST = location.pathname.includes('/test/');

const GAS_URL = IS_TEST
  ? 'https://script.google.com/macros/s/AKfycbzl8dfdhlZbIsgt6tSQahNW7mVoQmaNjsc4WJ4U_ETHcNS4MDojX5H5Ns5BX7J_TwKJvw/exec'
  : 'https://script.google.com/macros/s/AKfycbyOdcFoG1vsk6w_ginSdxyWQSc-PgLgHcvk6qMILMPeRh0h5CMutT1c-4EFZcQVhBq9/exec';

const LIFF_ID = IS_TEST ? '2009619528-aJO34c6u' : '2009611318-5UphK9JK';

const LS_UID  = IS_TEST ? 'liff_uid_test' : 'liff_uid';
