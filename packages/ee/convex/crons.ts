import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale pending uploads',
  { minutes: 5 },
  internal.comments.cleanupStalePendingUploads,
);

export default crons;
