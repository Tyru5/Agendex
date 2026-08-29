import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale pending uploads',
  { minutes: 5 },
  internal.comments.cleanupStalePendingUploads,
);

crons.interval(
  'cleanup expired data exports',
  { hours: 24 },
  internal.dataExport.deleteExpiredDataExports,
);

crons.interval(
  'backfill plan download lookup keys',
  { hours: 1 },
  internal.cli.backfillPlanDownloadLookupKeys,
);

export default crons;
