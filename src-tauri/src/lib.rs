mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(oauth::OAuthState::default())
        .invoke_handler(tauri::generate_handler![oauth::oauth_listen, oauth::oauth_wait, oauth::oauth_cancel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
