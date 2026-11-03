use crate::safe_filesystem;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum CacheKey { Physical(u64, u64), Path(PathBuf) }

fn state() -> &'static Mutex<BTreeSet<CacheKey>> {
    static STATE: OnceLock<Mutex<BTreeSet<CacheKey>>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

pub(crate) fn require_recovery(cache: &Path) {
    let identity = safe_filesystem::identity(cache).ok();
    let mut state = state().lock().expect("web recovery state");
    state.insert(CacheKey::Path(cache.into()));
    if let Some(identity) = identity { state.insert(CacheKey::Physical(identity.volume, identity.file)); }
}

pub(crate) fn recovery_required(cache: &Path) -> bool {
    let identity = safe_filesystem::identity(cache).ok();
    let state = state().lock().expect("web recovery state");
    state.contains(&CacheKey::Path(cache.into()))
        || identity.is_some_and(|identity| state.contains(&CacheKey::Physical(identity.volume, identity.file)))
}
