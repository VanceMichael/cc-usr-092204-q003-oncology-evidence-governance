// 零依赖的 JSON Schema 子集校验器，覆盖本仓库契约用到的关键字。
// 支持：type（含 type 数组与 null）、required、properties、additionalProperties、
// items、minItems、enum、pattern。

const TYPE_NAMES = {
  string: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  object: "object",
  array: "array",
  null: "null",
};

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

// 返回错误信息数组；空数组表示通过。
export function validate(instance, schema, path = "$") {
  const errors = [];

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesType(instance, type))) {
      errors.push(`${path}：类型应为 ${allowed.map((t) => TYPE_NAMES[t] ?? t).join(" 或 ")}，实际为 ${typeOf(instance)}`);
      // 类型不符时不再继续本层结构校验，避免级联误报。
      return errors;
    }
  }

  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(instance))) {
    errors.push(`${path}：值不在允许集合中（${schema.enum.join("、")}）`);
  }

  if (schema.pattern && typeof instance === "string") {
    const re = new RegExp(schema.pattern);
    if (!re.test(instance)) errors.push(`${path}：不符合格式 ${schema.pattern}`);
  }

  if (typeOf(instance) === "object" && schema.properties) {
    for (const key of schema.required ?? []) {
      if (!(key in instance)) errors.push(`${path}：缺少必填字段 ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in schema.properties)) errors.push(`${path}：不允许出现额外字段 ${key}`);
      }
    }
    for (const [key, subschema] of Object.entries(schema.properties)) {
      if (key in instance) errors.push(...validate(instance[key], subschema, `${path}.${key}`));
    }
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${path}：至少包含 ${schema.minItems} 项，实际 ${instance.length} 项`);
    }
    if (schema.items) {
      instance.forEach((item, index) => {
        errors.push(...validate(item, schema.items, `${path}[${index}]`));
      });
    }
  }

  return errors;
}

// 载入并校验；不通过时抛出汇总错误，避免带病数据进入服务。
export async function loadValidated(fetchJson, schema, label) {
  const data = await fetchJson();
  const errors = validate(data, schema);
  if (errors.length > 0) {
    throw new Error(`${label}未通过契约校验：\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }
  return data;
}
