import { z } from 'zod';

// Friendlier default for missing fields than zod's "expected string, received undefined".
z.config({
  customError: (issue) => (issue.input === undefined ? 'This field is required' : undefined),
});
