// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 读取本地文件字节（Tauri 端直接操作本地文件，浏览器端由 Web 层读 blob）。
/// 返回字节数组，供前端计算 MD5 / pHash / dHash / aHash。
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
}

/// 删除（移动至回收站）一批重复文件。
/// 为避免不可逆误删，文件被移入各自目录下的 `.dedup_trash` 子目录（可通过移动回去恢复）。
#[tauri::command]
fn remove_duplicate_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    let mut removed = Vec::new();
    for p in paths {
        let path = Path::new(&p);
        if !path.exists() {
            continue;
        }
        if let Some(parent) = path.parent() {
            let trash = parent.join(".dedup_trash");
            fs::create_dir_all(&trash).map_err(|e| format!("创建回收站失败: {}", e))?;
            if let Some(name) = path.file_name() {
                let dest = trash.join(name);
                // 目标已存在则加后缀，避免覆盖
                let final_dest = if dest.exists() {
                    let mut cand = dest.clone();
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let ext = path.extension().unwrap_or_default().to_string_lossy().to_string();
                    let mut i = 1;
                    loop {
                        cand = trash.join(format!("{}_{}.{}", stem, i, ext));
                        if !cand.exists() {
                            break;
                        }
                        i += 1;
                    }
                    cand
                } else {
                    dest
                };
                fs::rename(&path, &final_dest)
                    .map_err(|e| format!("删除 {} 失败: {}", p, e))?;
                removed.push(p);
            }
        }
    }
    Ok(removed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_file_bytes,
            remove_duplicate_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
