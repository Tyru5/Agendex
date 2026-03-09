import { defaultSchema } from 'rehype-sanitize';

const SLUG_SAFE_ANCHOR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div || []), ['dataAgendexAnchor', SLUG_SAFE_ANCHOR]],
  },
};
