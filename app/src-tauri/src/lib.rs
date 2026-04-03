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
  use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
  use cocoa::base::id;
  use tauri::Manager;

  let window = app
    .get_webview_window("main")
    .expect("missing main webview window");

  window.set_always_on_top(true)?;
  window.set_visible_on_all_workspaces(true)?;

  if let Some(monitor) = window.current_monitor()? {
    let monitor_size = monitor.size();
    let window_size = window.outer_size()?;
    let x = monitor_size.width as i32 - window_size.width as i32;
    let y = monitor_size.height as i32 - window_size.height as i32;
    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))?;
  }

  let ns_window = window
    .ns_window()
    .expect("failed to get native macOS window") as id;

  unsafe {
    ns_window.setCollectionBehavior_(
      NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
    );
  }

  app.set_activation_policy(tauri::ActivationPolicy::Accessory);

  Ok(())
}
