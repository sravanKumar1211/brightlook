export const numericTransformer = {
  to: (v) => v,
  from: (v) => (v === null || v === undefined ? null : Number(v)),
};

