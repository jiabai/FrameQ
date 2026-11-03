use super::*;

fn workspace() -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/web-removal").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

#[test]
fn opened_root_cannot_be_exchanged_before_recursive_deletion() {
    let parent = workspace();
    let root = parent.join("owned");
    let unrelated = parent.join("unrelated");
    fs::create_dir_all(root.join("profile/deep")).unwrap();
    fs::write(root.join("profile/deep/cache"), b"owned bytes").unwrap();
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("sentinel"), b"unrelated bytes").unwrap();
    let tree = Tree::open(&root, safe::identity(&root).unwrap()).unwrap();
    assert!(fs::rename(&root, parent.join("moved-owned")).is_err());
    assert!(fs::rename(&unrelated, &root).is_err());
    tree.remove().unwrap();
    assert!(!root.exists());
    assert_eq!(fs::read(unrelated.join("sentinel")).unwrap(), b"unrelated bytes");
}

#[test]
fn replacement_root_is_rejected_before_deleting_any_content() {
    let parent = workspace();
    let root = parent.join("owned");
    fs::create_dir(&root).unwrap();
    let expected = safe::identity(&root).unwrap();
    fs::rename(&root, parent.join("retained-owned")).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("sentinel"), b"replacement bytes").unwrap();
    assert!(Tree::open(&root, expected).is_err());
    assert_eq!(fs::read(root.join("sentinel")).unwrap(), b"replacement bytes");
}

#[test]
fn locked_profile_file_keeps_owner_receipt_for_a_later_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let parent = workspace();
    let root = parent.join("owned");
    fs::create_dir_all(root.join("profile")).unwrap();
    let receipt = b"durable owner receipt";
    fs::write(root.join("owner.json"), receipt).unwrap();
    let locked_path = root.join("profile/locked");
    fs::write(&locked_path, b"owned bytes").unwrap();
    let lock = fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&locked_path).unwrap();
    let expected = safe::identity(&root).unwrap();
    assert!(Tree::open(&root, expected).unwrap().remove().is_err());
    assert_eq!(fs::read(root.join("owner.json")).unwrap(), receipt);
    assert_eq!(fs::read(&locked_path).unwrap(), b"owned bytes");
    drop(lock);
    Tree::open(&root, expected).unwrap().remove().unwrap();
    assert!(!root.exists());
}

#[test]
fn directory_junction_and_readonly_hardlink_leave_external_content_untouched() {
    use std::os::windows::process::CommandExt;
    let parent = workspace();
    let root = parent.join("owned");
    let outside = parent.join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    let sentinel = outside.join("sentinel");
    fs::write(&sentinel, b"external bytes").unwrap();
    fs::hard_link(&sentinel, root.join("hardlink")).unwrap();
    let mut permissions = fs::metadata(&sentinel).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&sentinel, permissions).unwrap();
    let status = std::process::Command::new("cmd.exe").args(["/c", "mklink", "/J"])
        .arg(root.join("junction")).arg(&outside).creation_flags(0x0800_0000)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
    assert!(status.success());
    Tree::open(&root, safe::identity(&root).unwrap()).unwrap().remove().unwrap();
    assert!(!root.exists());
    assert_eq!(fs::read(&sentinel).unwrap(), b"external bytes");
    assert!(fs::metadata(sentinel).unwrap().permissions().readonly());
}
