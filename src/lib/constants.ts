export const UK_REGIONS = [
  "East Midlands", "East of England", "London", "North East",
  "North West", "Northern Ireland", "Scotland", "South East",
  "South West", "Wales", "West Midlands", "Yorkshire and the Humber",
] as const;

export const POSTER_CATEGORIES = [
  { value: "full_lineup", label: "Full Lineup" },
  { value: "main_stage", label: "Main Stage" },
  { value: "second_stage", label: "Second Stage" },
  { value: "third_stage", label: "Third Stage" },
  { value: "day_1", label: "Day 1" },
  { value: "day_2", label: "Day 2" },
  { value: "day_3", label: "Day 3" },
  { value: "day_4", label: "Day 4" },
  { value: "dance_electronic", label: "Dance / Electronic" },
  { value: "acoustic_unplugged", label: "Acoustic / Unplugged" },
  { value: "other", label: "Other" },
] as const;
