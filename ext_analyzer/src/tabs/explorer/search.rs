use crate::types::Extension;

pub fn filter_extensions<'a>(
    extensions: &'a [Extension],
    search_query: &str,
) -> Vec<&'a Extension> {
    extensions
        .iter()
        .filter(|ext| {
            search_query.is_empty()
                || ext
                    .name
                    .to_lowercase()
                    .contains(&search_query.to_lowercase())
                || ext
                    .get_id()
                    .to_lowercase()
                    .contains(&search_query.to_lowercase())
                || ext
                    .tags
                    .iter()
                    .any(|t| t.to_lowercase().contains(&search_query.to_lowercase()))
        })
        .collect()
}

use rand::seq::SliceRandom;
use rand::thread_rng;

#[derive(Clone, Copy)]
pub enum SortBy {
    InterestingnessAsc,
    InterestingnessDesc,
    Random,
}

impl SortBy {
    pub fn next(&self) -> Self {
        match self {
            SortBy::InterestingnessAsc => SortBy::InterestingnessDesc,
            SortBy::InterestingnessDesc => SortBy::Random,
            SortBy::Random => SortBy::InterestingnessAsc,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SortBy::InterestingnessAsc => "interestingness ↑",
            SortBy::InterestingnessDesc => "interestingness ↓",
            SortBy::Random => "random",
        }
    }

    pub fn to_param(&self) -> &'static str {
        match self {
            SortBy::InterestingnessAsc => "interestingness_asc",
            SortBy::InterestingnessDesc => "interestingness_desc",
            SortBy::Random => "random",
        }
    }
}

pub fn sort_extensions(extensions: &mut Vec<&Extension>, sort_by: SortBy, search_query: &str) {
    match sort_by {
        SortBy::InterestingnessAsc => {
            extensions.sort_by(|a, b| {
                a.interestingness
                    .unwrap_or(0.0)
                    .partial_cmp(&b.interestingness.unwrap_or(0.0))
                    .unwrap()
            });
        }
        SortBy::InterestingnessDesc => {
            extensions.sort_by(|a, b| {
                b.interestingness
                    .unwrap_or(0.0)
                    .partial_cmp(&a.interestingness.unwrap_or(0.0))
                    .unwrap()
            });
        }
        SortBy::Random => {
            let mut rng = thread_rng();
            extensions.shuffle(&mut rng);
        }
    }
}
