use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const REDIRECT_TIMEOUT: Duration = Duration::from_secs(300);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

const SUCCESS_PAGE: &str = "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Runote</title><body style=\"font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem\"><h1>Connexion terminée</h1><p>Vous pouvez fermer cette page et revenir dans Runote.</p></body></html>";

#[derive(Default)]
pub struct OAuthState {
    listener: Mutex<Option<TcpListener>>,
    generation: Arc<AtomicU64>,
}

#[tauri::command]
pub fn oauth_listen(state: tauri::State<'_, OAuthState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.listener.lock().map_err(|error| error.to_string())? = Some(listener);
    Ok(port)
}

#[tauri::command]
pub async fn oauth_wait(state: tauri::State<'_, OAuthState>) -> Result<String, String> {
    let listener = state
        .listener
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("Aucune connexion Google en cours.")?;
    let generations = Arc::clone(&state.generation);
    let generation = generations.load(Ordering::SeqCst);

    tauri::async_runtime::spawn_blocking(move || {
        wait_for_redirect(&listener, || generations.load(Ordering::SeqCst) == generation)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn oauth_cancel(state: tauri::State<'_, OAuthState>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
}

fn wait_for_redirect(listener: &TcpListener, still_current: impl Fn() -> bool) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + REDIRECT_TIMEOUT;

    loop {
        if !still_current() {
            return Err("Connexion Google annulée.".into());
        }

        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(target) = answer(stream)? {
                    return Ok(target);
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("La connexion Google a expiré. Réessaie.".into());
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn answer(mut stream: TcpStream) -> Result<Option<String>, String> {
    stream.set_nonblocking(false).map_err(|error| error.to_string())?;
    let mut request_line = String::new();
    BufReader::new(&stream)
        .read_line(&mut request_line)
        .map_err(|error| error.to_string())?;
    let target = request_line.split_whitespace().nth(1).unwrap_or_default().to_string();

    if !target.starts_with("/?") {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return Ok(None);
    }

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        SUCCESS_PAGE.len(),
        SUCCESS_PAGE
    );
    let _ = stream.write_all(response.as_bytes());
    Ok(Some(target))
}
