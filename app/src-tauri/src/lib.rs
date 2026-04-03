const DEFAULT_WINDOW_WIDTH: u32 = 200;

#[tauri::command]
fn expand_window(window: tauri::Window, width: u32) -> Result<(), String> {
  let current_size = window.outer_size().map_err(|error| error.to_string())?;
  let current_position = window.outer_position().map_err(|error| error.to_string())?;

  let next_width = width.max(DEFAULT_WINDOW_WIDTH);
  if next_width == current_size.width {
    return Ok(());
  }

  let right_edge = current_position.x + current_size.width as i32;
  let next_x = right_edge - next_width as i32;

  window
    .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
      next_width,
      current_size.height,
    )))
    .map_err(|error| error.to_string())?;

  window
    .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
      next_x,
      current_position.y,
    )))
    .map_err(|error| error.to_string())?;

  Ok(())
}

#[tauri::command]
fn shrink_window(window: tauri::Window) -> Result<(), String> {
  let current_size = window.outer_size().map_err(|error| error.to_string())?;
  let current_position = window.outer_position().map_err(|error| error.to_string())?;

  if current_size.width == DEFAULT_WINDOW_WIDTH {
    return Ok(());
  }

  let right_edge = current_position.x + current_size.width as i32;
  let next_x = right_edge - DEFAULT_WINDOW_WIDTH as i32;

  window
    .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
      DEFAULT_WINDOW_WIDTH,
      current_size.height,
    )))
    .map_err(|error| error.to_string())?;

  window
    .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
      next_x,
      current_position.y,
    )))
    .map_err(|error| error.to_string())?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![expand_window, shrink_window])
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
