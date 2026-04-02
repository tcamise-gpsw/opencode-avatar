#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(target_os = "macos")]
      configure_overlay_window(app)?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn configure_overlay_window<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
  use cocoa::appkit::{NSMainMenuWindowLevel, NSWindow, NSWindowCollectionBehavior};
  use cocoa::base::id;
  use tauri::Manager;

  let window = app
    .get_webview_window("main")
    .expect("missing main webview window");

  window.set_always_on_top(true)?;
  window.set_visible_on_all_workspaces(true)?;

  let ns_window = window
    .ns_window()
    .expect("failed to get native macOS window") as id;

  unsafe {
    ns_window.setCollectionBehavior_(
      NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
    );
    ns_window.setLevel_(NSMainMenuWindowLevel as i64 + 1);
  }

  app.set_activation_policy(tauri::ActivationPolicy::Accessory);

  Ok(())
}
