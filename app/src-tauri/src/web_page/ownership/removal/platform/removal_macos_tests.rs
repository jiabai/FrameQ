use super::*;
use std::{fs, path::PathBuf};

fn workspace() -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/web-removal").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

#[test]
fn exchanged_root_keeps_replacement_and_external_symlink_target() {
    let parent = workspace();
    let root = parent.join("owned");
    let retained = parent.join("retained");
    let external = parent.join("external");
    fs::create_dir_all(root.join("deep")).unwrap();
    fs::create_dir(&external).unwrap();
    fs::write(root.join("deep/cache"), b"owned bytes").unwrap();
    fs::write(external.join("sentinel"), b"external bytes").unwrap();
    std::os::unix::fs::symlink(&external, root.join("link")).unwrap();
    let tree = Tree::open(&root, safe::identity(&root).unwrap()).unwrap();
    fs::rename(&root, &retained).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("replacement"), b"replacement bytes").unwrap();
    assert!(tree.remove().is_err());
    assert_eq!(fs::read(root.join("replacement")).unwrap(), b"replacement bytes");
    assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"external bytes");
    assert!(retained.is_dir());
}
