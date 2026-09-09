// Kaolin-Assets 桌面端入口（Tauri v2，T-6.1；导出对话框 2026-09-08）
//
// 职责：
//   1. 承载 Web 前端（../dist，React 生产构建）；
//   2. 文件关联 .kaolin-scene.json：双击场景文件 → RunEvent::Opened →
//      Rust 读取文件内容 → 以事件推给前端 loadScene（前端监听见 src/main.tsx）；
//   3. 导出落盘（2026-09-08）：WKWebView 的 <a download> 不触发下载，改为
//      前端调 tauri-plugin-dialog 原生保存对话框取路径 + save_file 命令写文件。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

/// 写文件（前端导出统一入口）。path 为目录时自动拼 filename（分层导出选目录批量写）。
#[tauri::command]
fn save_file(path: String, filename: Option<String>, data: Vec<u8>) -> Result<(), String> {
    let base = std::path::PathBuf::from(&path);
    let final_path = if base.is_dir() {
        base.join(filename.unwrap_or_else(|| "kaolin-export.bin".to_string()))
    } else {
        base
    };
    if let Some(parent) = final_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&final_path, data).map_err(|e| format!("写入失败 {}: {}", final_path.display(), e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
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
