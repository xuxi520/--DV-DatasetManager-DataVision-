// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::{Deserialize, Serialize};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 读取本地文本文件（Tauri 端直接读取标注等小文件，浏览器端由 Web 层读 blob）。
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
}

/// 单条扫描结果：相对根路径（规范 '/') + 绝对路径 + 字节大小 + 图片宽高。
/// 宽高在 Rust 扫描期直接由文件头解析（同 X-AnyLabeling 的原生层预解析），
/// 免去前端逐图 read_file_bytes 的 N 次 IPC 往返，加载近乎瞬时。
#[derive(Serialize, Deserialize)]
struct ScanEntry {
    relative_path: String,
    absolute_path: String,
    size: u64,
    width: u32,
    height: u32,
}

/// 读取文件头部（最多 max 字节）用于解析图片尺寸，避免整图读入内存。
fn read_head(path: &std::path::Path, max: usize) -> Vec<u8> {
    use std::io::Read;
    if let Ok(f) = std::fs::File::open(path) {
        let mut buf = Vec::with_capacity(max.min(8192));
        let mut handle = f.take(max as u64);
        let mut tmp = [0u8; 8192];
        loop {
            match handle.read(&mut tmp) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&tmp[..n]),
                Err(_) => break,
            }
        }
        buf
    } else {
        Vec::new()
    }
}

/// 由图片字节头部解析宽高（零解码），支持 JPEG/PNG/GIF/BMP/WebP(VP8/VP8X/VP8L)。
/// 对应前端 env.parseImageSize 的 Rust 版。
fn parse_image_dims(head: &[u8]) -> Option<(u32, u32)> {
    if head.len() < 16 {
        return None;
    }

    // PNG: IHDR@12 -> width@16(4 BE) height@20(4 BE)
    if head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4e && head[3] == 0x47 {
        if head.len() < 24 {
            return None;
        }
        let w = u32::from_be_bytes([head[16], head[17], head[18], head[19]]);
        let h = u32::from_be_bytes([head[20], head[21], head[22], head[23]]);
        return Some((w, h));
    }

    // JPEG: FF D8 ... SOF0~SOF15（除 C4/C8/CC）处取尺寸
    if head[0] == 0xff && head[1] == 0xd8 {
        let mut i = 2usize;
        while i + 9 < head.len() {
            if head[i] != 0xff {
                i += 1;
                continue;
            }
            let marker = head[i + 1];
            if marker == 0xd9 || marker == 0xda {
                break; // EOI / SOS：之后无 SOF
            }
            if marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc
            {
                let h = ((head[i + 5] as u32) << 8) | head[i + 6] as u32;
                let w = ((head[i + 7] as u32) << 8) | head[i + 8] as u32;
                return Some((w, h));
            }
            let len = ((head[i + 2] as usize) << 8) | head[i + 3] as usize;
            if len == 0 {
                break;
            }
            i += 2 + len;
        }
        return None;
    }

    // GIF: 'GIF' width@6(2 LE) height@8(2 LE)
    if head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 {
        if head.len() < 10 {
            return None;
        }
        let w = head[6] as u32 | ((head[7] as u32) << 8);
        let h = head[8] as u32 | ((head[9] as u32) << 8);
        return Some((w, h));
    }

    // BMP: 'BM' width@18(4 LE) height@22(4 LE)
    if head[0] == 0x42 && head[1] == 0x4d {
        if head.len() < 26 {
            return None;
        }
        let w = u32::from_le_bytes([head[18], head[19], head[20], head[21]]);
        let h = u32::from_le_bytes([head[22], head[23], head[24], head[25]]);
        return Some((w, h));
    }

    // WEBP: 'RIFF'....'WEBP' + 子格式
    if head[0] == 0x52 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x46
        && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50
    {
        if head.len() < 30 {
            return None;
        }
        let fourcc = [
            head[12] as char,
            head[13] as char,
            head[14] as char,
            head[15] as char,
        ];
        if fourcc == ['V', 'P', '8', 'X'] {
            let w = (head[24] as u32 | ((head[23] as u32) << 8) | ((head[22] as u32) << 16)) + 1;
            let h = (head[27] as u32 | ((head[26] as u32) << 8) | ((head[25] as u32) << 16)) + 1;
            return Some((w, h));
        }
        if fourcc == ['V', 'P', '8', ' '] {
            let w = (head[26] as u32 | ((head[27] as u32) << 8)) & 0x3fff;
            let h = (head[28] as u32 | ((head[29] as u32) << 8)) & 0x3fff;
            return Some((w, h));
        }
        if fourcc == ['V', 'P', '8', 'L'] {
            let bits =
                ((head[21] as u32) << 16) | ((head[22] as u32) << 8) | head[23] as u32;
            let w = (bits & 0x3fff) + 1;
            let h = ((bits >> 14) & 0x3fff) + 1;
            return Some((w, h));
        }
    }

    None
}

#[derive(Serialize, Deserialize)]
struct ScanResult {
    images: Vec<ScanEntry>,
    annotations: Vec<ScanEntry>,
}

const IMG_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp", "gif", "tiff", "tif", "avif"];
const ANN_EXTS: &[&str] = &["txt", "xml", "json"];

/// 递归扫描数据集目录，把图片与标注文件分类列出（相对路径 + 绝对路径 + 大小）。
/// 递归在 Rust 侧完成，前端无需逐目录 enumerate。
#[tauri::command]
fn scan_dataset_dir(root: String) -> Result<ScanResult, String> {
    use std::path::Path;

    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("不是有效目录: {}", root));
    }

    let mut images: Vec<ScanEntry> = Vec::new();
    let mut annotations: Vec<ScanEntry> = Vec::new();

    fn walk(
        dir: &Path,
        root: &Path,
        images: &mut Vec<ScanEntry>,
        annotations: &mut Vec<ScanEntry>,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, images, annotations)?;
            } else if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let absolute_path = path.to_string_lossy().replace('\\', "/");
                let relative_path = path
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| absolute_path.clone());
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                // 图片在扫描期顺手解析宽高（读文件头，不整图读入）；标注宽高置 0
                let (width, height) = if IMG_EXTS.contains(&ext.as_str()) {
                    let head = read_head(&path, 256 * 1024);
                    parse_image_dims(&head).unwrap_or((0, 0))
                } else {
                    (0, 0)
                };
                let e = ScanEntry {
                    relative_path,
                    absolute_path,
                    size,
                    width,
                    height,
                };
                if IMG_EXTS.contains(&ext.as_str()) {
                    images.push(e);
                } else if ANN_EXTS.contains(&ext.as_str()) {
                    annotations.push(e);
                }
            }
        }
        Ok(())
    }

    walk(root_path, root_path, &mut images, &mut annotations)?;
    Ok(ScanResult { images, annotations })
}

/// 读取本地文件字节（Tauri 端直接操作本地文件，浏览器端由 Web 层读 blob）。
/// 返回字节数组，供前端计算 MD5 / pHash / dHash / aHash。
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
}

/// 手写 base64 编码（零额外依赖），用于把批量字节以字符串形式经 JSON 传输，
/// 比 `Vec<u8>` 默认的数字数组序列化体积小约 2.6 倍。
fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | input[i + 2] as u32;
        out.push(ALPHABET[(n >> 18) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 0x3f) as usize] as char);
        out.push(ALPHABET[(n & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(ALPHABET[(n >> 18) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3f) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push(ALPHABET[(n >> 18) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}

/// 批量读取多个文件字节（Tauri 端一次性 IPC 取回多张图，消除逐图 read_file_bytes 的
/// N 次往返）。返回与 paths 等长、一一对应的 base64 字符串；读取失败的项为空串。
/// 用于去重哈希与导出等需要多图字节的场景（对齐 X-AnyLabeling 的原生层批量读取）。
#[tauri::command]
fn read_files_bytes(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        match std::fs::read(&p) {
            Ok(bytes) => out.push(base64_encode(&bytes)),
            Err(_) => out.push(String::new()),
        }
    }
    Ok(out)
}

// 写二进制文件（导出 ZIP / 报表等）。
// 路径来自保存对话框用户所选位置；父目录若不存在则自动创建。
// 用于桌面端替代浏览器 blob 下载（WebView 会静默丢弃 blob: 下载，导致「点了没反应」）。
#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    use std::path::Path;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
        }
    }
    std::fs::write(&path, contents).map_err(|e| format!("写入失败 {}: {}", path, e))
}

// 批量写文件（导出增强数据集等）：一次 IPC 替代 N 次往返，Rust 端顺序写盘。
// 图片字节直接以 Vec<u8> 传递（Tauri v2 走二进制载荷，避免前端 Array.from 的逐字节序列化开销）。
#[tauri::command]
fn write_files_batch(paths: Vec<String>, contents: Vec<Vec<u8>>) -> Result<usize, String> {
    use std::path::Path;
    if paths.len() != contents.len() {
        return Err("paths 与 contents 长度不一致".into());
    }
    let mut written = 0usize;
    for (path, data) in paths.into_iter().zip(contents.into_iter()) {
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
            }
        }
        std::fs::write(&path, data).map_err(|e| format!("写入失败 {}: {}", path, e))?;
        written += 1;
    }
    Ok(written)
}

// 写回文本文件（标注编辑后持久化到原标注文件）。
// 路径来自已加载数据集的标注绝对路径；父目录若不存在则自动创建。
// 用于「清洗台」保存对 bbox/类别/新增·删除标注的修改（Tauri 桌面端直接落盘）。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    use std::path::Path;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
        }
    }
    std::fs::write(&path, content).map_err(|e| format!("写入失败 {}: {}", path, e))
}

// 直接删除一批文件（不可逆）。供「删除图片并同步删除标注」等需要真正删除的场景。
// 仅删除存在的普通文件，目录或不存在的路径跳过；返回实际删除的路径。
#[tauri::command]
fn delete_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    let mut removed = Vec::new();
    for p in paths {
        let path = Path::new(&p);
        if path.is_file() {
            fs::remove_file(path).map_err(|e| format!("删除 {} 失败: {}", p, e))?;
            removed.push(p);
        }
    }
    Ok(removed)
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
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let ext = path.extension().unwrap_or_default().to_string_lossy().to_string();
                    let mut i = 1;
                    let mut cand = trash.join(format!("{}_{}.{}", stem, i, ext));
                    loop {
                        if !cand.exists() {
                            break;
                        }
                        i += 1;
                        cand = trash.join(format!("{}_{}.{}", stem, i, ext));
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

/// 删除 COCO 单文件标注 JSON 中指定图片条目及其标注（条目级删除），并就地写回。
/// 为避免不可逆误删，改写前先备份原 JSON 到同目录 `.dedup_trash/<名>_<时间戳>.json`。
/// `remove_file_names` 为要删除图片的 file_name（相对路径，与 CanonicalSample.sourcePath 一致）。
/// 匹配同时支持精确路径与 basename 兜底；兼容数字 / 字符串 image id。
/// 返回被移除的 image id 列表（字符串形式）。
#[tauri::command]
fn rewrite_coco_json(
    json_path: String,
    remove_file_names: Vec<String>,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    let text = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("读取 COCO json 失败 {}: {}", json_path, e))?;
    let mut data: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析 COCO json 失败 {}: {}", json_path, e))?;

    // 归一化待删集合（精确匹配 + basename 兜底）
    let norm = |s: &str| -> String { s.replace('\\', "/") };
    let removes: HashSet<String> = remove_file_names.iter().map(|s| norm(s)).collect();
    let removes_base: HashSet<String> = remove_file_names
        .iter()
        .map(|s| {
            let n = norm(s);
            n.rsplit('/').next().unwrap_or(&n).to_string()
        })
        .collect();

    let mut removed_ids: Vec<serde_json::Value> = Vec::new();
    if let Some(imgs) = data.get_mut("images").and_then(|v| v.as_array_mut()) {
        let mut kept = Vec::new();
        for im in imgs.drain(..) {
            let fname = im.get("file_name").and_then(|v| v.as_str()).unwrap_or("");
            let fname_n = norm(fname);
            let base = fname_n.rsplit('/').next().unwrap_or(&fname_n);
            let to_remove = removes.contains(&fname_n) || removes_base.contains(base);
            if to_remove {
                if let Some(id) = im.get("id").cloned() {
                    removed_ids.push(id);
                }
                continue;
            }
            kept.push(im);
        }
        if let Some(arr) = data.get_mut("images") {
            *arr = serde_json::Value::Array(kept);
        }
    } else {
        return Err(format!("COCO json 缺少 images 数组：{}", json_path));
    }

    if removed_ids.is_empty() {
        // 无匹配条目，不改动文件
        return Ok(removed_ids.iter().map(|v| v.to_string()).collect());
    }

    // 移除对应 annotations
    if let Some(anns) = data.get_mut("annotations").and_then(|v| v.as_array_mut()) {
        let kept_anns: Vec<serde_json::Value> = anns
            .drain(..)
            .filter(|a| match a.get("image_id") {
                Some(iid) => !removed_ids.iter().any(|r| r == iid),
                None => true,
            })
            .collect();
        if let Some(arr) = data.get_mut("annotations") {
            *arr = serde_json::Value::Array(kept_anns);
        }
    }

    // 备份原 JSON 到 .dedup_trash
    let path = Path::new(&json_path);
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法获取父目录：{}", json_path))?;
    let trash = parent.join(".dedup_trash");
    std::fs::create_dir_all(&trash).map_err(|e| format!("创建回收站失败: {}", e))?;
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bak_path = trash.join(format!("{}_coco_{}.json.bak", stem, ts));
    std::fs::write(&bak_path, &text).map_err(|e| format!("备份 COCO json 失败: {}", e))?;

    // 写回改写后的 JSON
    let out = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化 COCO json 失败: {}", e))?;
    std::fs::write(path, out).map_err(|e| format!("写回 COCO json 失败 {}: {}", json_path, e))?;

    Ok(removed_ids.iter().map(|v| v.to_string()).collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        greet,
        read_file_bytes,
        read_files_bytes,
        read_file_text,
        scan_dataset_dir,
        remove_duplicate_files,
        delete_files,
        write_text_file,
        write_binary_file,
        write_files_batch,
        rewrite_coco_json
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
