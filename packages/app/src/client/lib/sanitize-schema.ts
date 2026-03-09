import { defaultSchema } from 'rehype-sanitize';

const SLUG_SAFE_ANCHOR = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;

export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div || []), ['dataAgendexAnchor', SLUG_SAFE_ANCHOR]],
  },
};
