export const tagOptions = [
  "男声",
  "女声",
  "组合",
  "合唱",
  "大陆",
  "港台",
  "欧美",
  "日韩",
  "国语",
  "粤语",
  "英语",
  "日语",
  "韩语",
  "流行",
  "摇滚",
  "怀旧",
  "现场",
  "MV",
  "伴奏",
];
export const normalizeTags = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : []).filter((v) => tagOptions.includes(v)),
  ),
];
