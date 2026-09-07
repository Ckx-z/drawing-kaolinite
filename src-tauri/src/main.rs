// Kaolin-Assets 桌面端入口（Tauri v2，T-6.1）
//
// 职责：
//   1. 承载 Web 前端（../dist，React 生产构建）；
//   2. 文件关联 .kaolin-scene.json：双击场景文件 → RunEvent::Opened →
//      Rust 读取文件内容 → 以事件推给前端 loadScene（前端监听见 src/main.tsx）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

fn main() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for u in urls {
                    // 文件关联 .kaolin-scene.json：file:// URL → 读取内容推给前端
                    if let Ok(path) = u.to_file_path() {
                        if path.extension().and_then(|e| e.to_str()) == Some("json") {
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                let _ = app_handle.emit("scene-open-content", content);
                            }
                        }
                    }
                }
            }
        });
}
