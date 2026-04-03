const DEFAULT_WINDOW_WIDTH: u32 = 200;

fn logical_to_physical_size(value: u32, scale_factor: f64) -> u32 {
    ((value as f64) * scale_factor).round().max(1.0) as u32
}

#[tauri::command]
fn expand_window(window: tauri::Window, width: u32) -> Result<(), String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let current_size = window.outer_size().map_err(|error| error.to_string())?;
    let current_position = window.outer_position().map_err(|error| error.to_string())?;

    let next_width = logical_to_physical_size(width.max(DEFAULT_WINDOW_WIDTH), scale_factor);
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
fn restore_window(window: tauri::Window) -> Result<(), String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let current_size = window.outer_size().map_err(|error| error.to_string())?;
    let current_position = window.outer_position().map_err(|error| error.to_string())?;
    let default_width = logical_to_physical_size(DEFAULT_WINDOW_WIDTH, scale_factor);

    if current_size.width == default_width {
        return Ok(());
    }

    let right_edge = current_position.x + current_size.width as i32;
    let next_x = right_edge - default_width as i32;

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            default_width,
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
fn maximize_window(window: tauri::Window, size: u32) -> Result<(), String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let current_position = window.outer_position().map_err(|error| error.to_string())?;
    let next_size = logical_to_physical_size(size.max(DEFAULT_WINDOW_WIDTH), scale_factor);
    let right_edge = current_position.x
        + window
            .outer_size()
            .map_err(|error| error.to_string())?
            .width as i32;
    let bottom_edge = current_position.y
        + window
            .outer_size()
            .map_err(|error| error.to_string())?
            .height as i32;
    let next_x = right_edge - next_size as i32;
    let next_y = bottom_edge - next_size as i32;

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            next_size, next_size,
        )))
        .map_err(|error| error.to_string())?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            next_x, next_y,
        )))
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            expand_window,
            restore_window,
            maximize_window
        ])
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
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
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
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )))?;
    }

    let ns_window = window
        .ns_window()
        .expect("failed to get native macOS window")
        .cast::<NSWindow>();

    unsafe {
        let ns_window = ns_window
            .as_ref()
            .expect("native macOS window pointer was null");
        ns_window.setHasShadow(false);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::Stationary,
        );
    }

    // Use a regular app activation policy so macOS provides the standard Dock
    // menu and app lifecycle actions like Quit.
    app.set_activation_policy(tauri::ActivationPolicy::Regular);

    Ok(())
}
