use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{ensure_runtime_dirs, path_to_env_string, resolve_runtime_paths, RuntimePaths};

pub(crate) const INSIGHT_PREFERENCES_FILE_NAME: &str = "insight-preferences.json";
const PROFILE_RESET_REQUIRED_MESSAGE: &str = "灵感档案需要重新设置";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspirationProfile {
    pub(crate) role: String,
    pub(crate) domain: String,
    pub(crate) stage: String,
    pub(crate) city_context: String,
    pub(crate) gender_perspective: String,
    pub(crate) platforms: Vec<String>,
    pub(crate) default_styles: Vec<String>,
    pub(crate) default_avoid: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerationPreferences {
    pub(crate) goal: String,
    pub(crate) scenario: String,
    pub(crate) angles: Vec<String>,
    pub(crate) audience: String,
    pub(crate) styles: Vec<String>,
    pub(crate) avoid: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InsightPreferenceStateView {
    pub(crate) profile: Option<InspirationProfile>,
    pub(crate) profile_skipped: bool,
    pub(crate) profile_status: String,
    pub(crate) profile_error: Option<String>,
    pub(crate) default_generation_preferences: Option<GenerationPreferences>,
    pub(crate) preferences_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct InsightPreferencesFile {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<InspirationProfile>,
    #[serde(default)]
    profile_skipped: bool,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    default_generation_preferences: Option<GenerationPreferences>,
}

#[tauri::command]
pub(crate) fn get_insight_preferences(
    app: AppHandle,
) -> Result<InsightPreferenceStateView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    load_insight_preferences_from_file(&insight_preferences_path(&paths))
}

#[tauri::command]
pub(crate) fn save_inspiration_profile(
    app: AppHandle,
    profile: InspirationProfile,
) -> Result<InsightPreferenceStateView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    save_inspiration_profile_to_file(&insight_preferences_path(&paths), profile)
}

#[tauri::command]
pub(crate) fn skip_inspiration_profile(
    app: AppHandle,
) -> Result<InsightPreferenceStateView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    skip_inspiration_profile_to_file(&insight_preferences_path(&paths))
}

#[tauri::command]
pub(crate) fn clear_inspiration_profile(
    app: AppHandle,
) -> Result<InsightPreferenceStateView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    clear_inspiration_profile_to_file(&insight_preferences_path(&paths))
}

#[tauri::command]
pub(crate) fn save_default_generation_preferences(
    app: AppHandle,
    preferences: GenerationPreferences,
) -> Result<InsightPreferenceStateView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    save_default_generation_preferences_to_file(&insight_preferences_path(&paths), preferences)
}

pub(crate) fn insight_preferences_path(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join(INSIGHT_PREFERENCES_FILE_NAME)
}

pub(crate) fn load_insight_preferences_from_file(
    path: &Path,
) -> Result<InsightPreferenceStateView, String> {
    if !path.exists() {
        return Ok(state_from_file(
            path,
            InsightPreferencesFile::default(),
            false,
        ));
    }

    let mut file = read_preferences_file(path)?;
    let mut default_was_invalid = false;
    if let Some(preferences) = file.default_generation_preferences.clone() {
        if !is_valid_generation_preferences(&preferences) {
            file.default_generation_preferences = None;
            default_was_invalid = true;
        }
    }
    if default_was_invalid {
        write_preferences_file(path, &file)?;
    }

    Ok(state_from_file(path, file, false))
}

pub(crate) fn save_inspiration_profile_to_file(
    path: &Path,
    profile: InspirationProfile,
) -> Result<InsightPreferenceStateView, String> {
    if !is_valid_inspiration_profile(&profile) {
        return Err("Invalid inspiration profile.".to_string());
    }

    let mut file = read_preferences_file_or_default(path)?;
    clear_invalid_default_generation_preferences(&mut file);
    file.profile = Some(profile);
    file.profile_skipped = false;
    write_preferences_file(path, &file)?;
    load_insight_preferences_from_file(path)
}

pub(crate) fn skip_inspiration_profile_to_file(
    path: &Path,
) -> Result<InsightPreferenceStateView, String> {
    let mut file = read_preferences_file_or_default(path)?;
    clear_invalid_default_generation_preferences(&mut file);
    file.profile = None;
    file.profile_skipped = true;
    write_preferences_file(path, &file)?;
    load_insight_preferences_from_file(path)
}

pub(crate) fn clear_inspiration_profile_to_file(
    path: &Path,
) -> Result<InsightPreferenceStateView, String> {
    let mut file = read_preferences_file_or_default(path)?;
    clear_invalid_default_generation_preferences(&mut file);
    file.profile = None;
    file.profile_skipped = false;
    write_preferences_file(path, &file)?;
    load_insight_preferences_from_file(path)
}

pub(crate) fn save_default_generation_preferences_to_file(
    path: &Path,
    preferences: GenerationPreferences,
) -> Result<InsightPreferenceStateView, String> {
    if !is_valid_generation_preferences(&preferences) {
        return Err("Invalid default generation preferences.".to_string());
    }

    let mut file = read_preferences_file_or_default(path)?;
    file.default_generation_preferences = Some(preferences);
    write_preferences_file(path, &file)?;
    load_insight_preferences_from_file(path)
}

fn state_from_file(
    path: &Path,
    file: InsightPreferencesFile,
    parse_failed: bool,
) -> InsightPreferenceStateView {
    if parse_failed {
        return InsightPreferenceStateView {
            profile: None,
            profile_skipped: false,
            profile_status: "invalid".to_string(),
            profile_error: Some(PROFILE_RESET_REQUIRED_MESSAGE.to_string()),
            default_generation_preferences: None,
            preferences_path: path_to_env_string(path),
        };
    }

    let has_profile = file.profile.is_some();
    let profile_is_valid = file
        .profile
        .as_ref()
        .map(is_valid_inspiration_profile)
        .unwrap_or(false);
    let profile_status = if profile_is_valid {
        "valid"
    } else if file.profile.is_some() {
        "invalid"
    } else if file.profile_skipped {
        "skipped"
    } else {
        "missing"
    };

    InsightPreferenceStateView {
        profile: if profile_is_valid { file.profile } else { None },
        profile_skipped: !profile_is_valid && !has_profile && file.profile_skipped,
        profile_status: profile_status.to_string(),
        profile_error: (profile_status == "invalid")
            .then(|| PROFILE_RESET_REQUIRED_MESSAGE.to_string()),
        default_generation_preferences: file
            .default_generation_preferences
            .filter(is_valid_generation_preferences),
        preferences_path: path_to_env_string(path),
    }
}

fn read_preferences_file_or_default(path: &Path) -> Result<InsightPreferencesFile, String> {
    if path.exists() {
        read_preferences_file(path)
    } else {
        Ok(InsightPreferencesFile::default())
    }
}

fn read_preferences_file(path: &Path) -> Result<InsightPreferencesFile, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_preferences_file(path: &Path, file: &InsightPreferencesFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(file).map_err(|error| error.to_string())? + "\n",
    )
    .map_err(|error| error.to_string())
}

fn clear_invalid_default_generation_preferences(file: &mut InsightPreferencesFile) {
    if file
        .default_generation_preferences
        .as_ref()
        .map(|preferences| !is_valid_generation_preferences(preferences))
        .unwrap_or(false)
    {
        file.default_generation_preferences = None;
    }
}

fn is_valid_inspiration_profile(profile: &InspirationProfile) -> bool {
    is_allowed_single(&profile.role, PROFILE_ROLE_IDS)
        && is_allowed_single(&profile.domain, PROFILE_DOMAIN_IDS)
        && is_allowed_single(&profile.stage, PROFILE_STAGE_IDS)
        && is_allowed_single(&profile.city_context, PROFILE_CITY_CONTEXT_IDS)
        && is_allowed_single(&profile.gender_perspective, PROFILE_GENDER_PERSPECTIVE_IDS)
        && is_allowed_multi(&profile.platforms, PROFILE_PLATFORM_IDS, 0, 3)
        && is_allowed_multi(&profile.default_styles, PROFILE_DEFAULT_STYLE_IDS, 0, 3)
        && is_allowed_multi(&profile.default_avoid, PROFILE_DEFAULT_AVOID_IDS, 0, 3)
}

fn is_valid_generation_preferences(preferences: &GenerationPreferences) -> bool {
    is_allowed_single(&preferences.goal, GENERATION_GOAL_IDS)
        && is_allowed_single(&preferences.scenario, GENERATION_SCENARIO_IDS)
        && is_allowed_multi(&preferences.angles, GENERATION_ANGLE_IDS, 1, 3)
        && is_allowed_single(&preferences.audience, GENERATION_AUDIENCE_IDS)
        && is_allowed_multi(&preferences.styles, GENERATION_STYLE_IDS, 1, 2)
        && is_allowed_multi(&preferences.avoid, GENERATION_AVOID_IDS, 0, 3)
}

fn is_allowed_single(value: &str, allowed: &[&str]) -> bool {
    allowed.contains(&value)
}

fn is_allowed_multi(values: &[String], allowed: &[&str], min: usize, max: usize) -> bool {
    if values.len() < min || values.len() > max {
        return false;
    }
    let mut seen = HashSet::new();
    values
        .iter()
        .all(|value| allowed.contains(&value.as_str()) && seen.insert(value))
}

const PROFILE_ROLE_IDS: &[&str] = &[
    "content_creator",
    "product_ops",
    "marketing_sales",
    "entrepreneur",
    "student_researcher",
    "teacher_trainer",
    "investor_business_analyst",
    "general_learner",
    "unspecified",
];
const PROFILE_DOMAIN_IDS: &[&str] = &[
    "content_media",
    "product_operations",
    "marketing_sales",
    "education_training",
    "technology_rd",
    "management_consulting",
    "investment_business",
    "freelance",
    "general_perspective",
    "unspecified",
];
const PROFILE_STAGE_IDS: &[&str] = &[
    "student",
    "early_career",
    "experienced_professional",
    "manager",
    "entrepreneur_operator",
    "retired",
    "unspecified",
];
const PROFILE_CITY_CONTEXT_IDS: &[&str] = &[
    "tier1_city",
    "new_tier1_city",
    "lower_tier_city",
    "county_township",
    "overseas",
    "unspecified",
];
const PROFILE_GENDER_PERSPECTIVE_IDS: &[&str] = &[
    "unspecified",
    "female_perspective",
    "male_perspective",
    "neutral_perspective",
];
const PROFILE_PLATFORM_IDS: &[&str] = &[
    "douyin",
    "xiaohongshu",
    "wechat_channels",
    "bilibili",
    "wechat_official_account",
    "podcast",
    "course_community",
    "internal_sharing",
];
const PROFILE_DEFAULT_STYLE_IDS: &[&str] = &[
    "direct_sharp",
    "gentle_inspiring",
    "professional_analysis",
    "grounded",
    "storytelling",
    "short_video_friendly",
    "long_form_friendly",
];
const PROFILE_DEFAULT_AVOID_IDS: &[&str] = &[
    "chicken_soup",
    "academic",
    "vague",
    "clickbait",
    "commercialized",
    "negative",
    "grand_narrative",
];
const GENERATION_GOAL_IDS: &[&str] = &[
    "content_creation",
    "learning_understanding",
    "review_deconstruction",
    "business_insight",
    "controversy_discussion",
    "action_advice",
];
const GENERATION_SCENARIO_IDS: &[&str] = &[
    "personal_notes",
    "short_video",
    "article_official_account",
    "livestream_podcast",
    "team_sharing",
    "client_communication",
    "course_community",
];
const GENERATION_ANGLE_IDS: &[&str] = &[
    "topic_angle",
    "contrarian_view",
    "audience_pain_point",
    "practical_advice",
    "case_analogy",
    "risk_controversy",
    "trend_judgment",
    "reusable_method",
    "memorable_phrase",
    "cognitive_refresh",
];
const GENERATION_AUDIENCE_IDS: &[&str] = &[
    "self",
    "beginners",
    "peers",
    "clients",
    "boss_team",
    "fans_readers",
];
const GENERATION_STYLE_IDS: &[&str] = &[
    "direct_sharp",
    "gentle_inspiring",
    "professional_analysis",
    "grounded",
    "storytelling",
    "short_video_friendly",
    "long_form_friendly",
];
const GENERATION_AVOID_IDS: &[&str] = &[
    "chicken_soup",
    "academic",
    "vague",
    "clickbait",
    "commercialized",
    "negative",
    "grand_narrative",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_missing_preferences_file_reports_missing_profile() {
        let path = temp_file("missing_preferences");

        let state = load_insight_preferences_from_file(&path).expect("load state");

        assert_eq!(state.profile, None);
        assert!(!state.profile_skipped);
        assert_eq!(state.profile_status, "missing");
        assert_eq!(state.profile_error, None);
        assert_eq!(state.default_generation_preferences, None);
        assert!(state.preferences_path.ends_with("insight-preferences.json"));
    }

    #[test]
    fn save_skip_and_clear_profile_round_trip() {
        let path = temp_file("profile_round_trip");

        let saved = save_inspiration_profile_to_file(&path, valid_profile()).expect("save profile");
        assert_eq!(saved.profile, Some(valid_profile()));
        assert!(!saved.profile_skipped);
        assert_eq!(saved.profile_status, "valid");

        let skipped = skip_inspiration_profile_to_file(&path).expect("skip profile");
        assert_eq!(skipped.profile, None);
        assert!(skipped.profile_skipped);
        assert_eq!(skipped.profile_status, "skipped");

        let cleared = clear_inspiration_profile_to_file(&path).expect("clear profile");
        assert_eq!(cleared.profile, None);
        assert!(!cleared.profile_skipped);
        assert_eq!(cleared.profile_status, "missing");
    }

    #[test]
    fn invalid_profile_requires_reset_and_preserves_valid_default_preferences() {
        let path = temp_file("invalid_profile");
        write_json(
            &path,
            r#"{
  "profile": {
    "role": "content_creation",
    "domain": "marketing_sales",
    "stage": "manager",
    "cityContext": "new_tier1_city",
    "genderPerspective": "unspecified",
    "platforms": ["douyin"],
    "defaultStyles": [],
    "defaultAvoid": []
  },
  "profileSkipped": false,
  "defaultGenerationPreferences": {
    "goal": "content_creation",
    "scenario": "short_video",
    "angles": ["topic_angle"],
    "audience": "beginners",
    "styles": ["direct_sharp"],
    "avoid": []
  }
}"#,
        );

        let state = load_insight_preferences_from_file(&path).expect("load state");

        assert_eq!(state.profile, None);
        assert!(!state.profile_skipped);
        assert_eq!(state.profile_status, "invalid");
        assert_eq!(
            state.profile_error,
            Some("灵感档案需要重新设置".to_string())
        );
        assert_eq!(
            state.default_generation_preferences,
            Some(valid_generation_preferences())
        );
    }

    #[test]
    fn invalid_default_generation_preferences_are_cleared_on_read() {
        let path = temp_file("invalid_default_generation_preferences");
        write_json(
            &path,
            r#"{
  "profile": null,
  "profileSkipped": true,
  "defaultGenerationPreferences": {
    "goal": "内容创作",
    "scenario": "short_video",
    "angles": [],
    "audience": "beginners",
    "styles": ["direct_sharp"],
    "avoid": []
  }
}"#,
        );

        let state = load_insight_preferences_from_file(&path).expect("load state");
        let written = fs::read_to_string(&path).expect("read preferences file");

        assert!(state.profile_skipped);
        assert_eq!(state.default_generation_preferences, None);
        assert!(!written.contains("defaultGenerationPreferences"));
    }

    #[test]
    fn save_profile_rejects_invalid_ids_before_writing() {
        let path = temp_file("reject_invalid_profile");
        let mut profile = valid_profile();
        profile.platforms = vec![
            "douyin".to_string(),
            "bilibili".to_string(),
            "podcast".to_string(),
            "xiaohongshu".to_string(),
        ];

        let error = save_inspiration_profile_to_file(&path, profile).expect_err("reject profile");

        assert!(error.contains("Invalid inspiration profile"));
        assert!(!path.exists());
    }

    #[test]
    fn save_default_generation_preferences_validates_ids_before_writing() {
        let path = temp_file("default_generation_preferences");

        let saved =
            save_default_generation_preferences_to_file(&path, valid_generation_preferences())
                .expect("save defaults");
        assert_eq!(
            saved.default_generation_preferences,
            Some(valid_generation_preferences())
        );

        let mut invalid = valid_generation_preferences();
        invalid.goal = "内容创作".to_string();
        let error = save_default_generation_preferences_to_file(&path, invalid)
            .expect_err("reject default");

        assert!(error.contains("Invalid default generation preferences"));
    }

    fn valid_profile() -> InspirationProfile {
        InspirationProfile {
            role: "marketing_sales".to_string(),
            domain: "marketing_sales".to_string(),
            stage: "manager".to_string(),
            city_context: "new_tier1_city".to_string(),
            gender_perspective: "unspecified".to_string(),
            platforms: vec!["douyin".to_string(), "bilibili".to_string()],
            default_styles: vec!["direct_sharp".to_string()],
            default_avoid: vec![],
        }
    }

    fn valid_generation_preferences() -> GenerationPreferences {
        GenerationPreferences {
            goal: "content_creation".to_string(),
            scenario: "short_video".to_string(),
            angles: vec!["topic_angle".to_string()],
            audience: "beginners".to_string(),
            styles: vec!["direct_sharp".to_string()],
            avoid: vec![],
        }
    }

    fn temp_file(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        std::env::temp_dir()
            .join("frameq-insight-preferences-tests")
            .join(format!("{name}-{millis}"))
            .join("insight-preferences.json")
    }

    fn write_json(path: &PathBuf, content: &str) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, content).expect("write json");
    }
}
