import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale pending uploads',
  { minutes: 5 },
  internal.comments.cleanupStalePendingUploads,
);

crons.interval(
  'cleanup stale agent avatar upload reservations',
  { minutes: 5 },
  internal.agentAvatars.cleanupStaleAgentAvatarUploadReservations,
);

crons.interval(
  'cleanup expired data exports',
  { hours: 24 },
  internal.dataExport.deleteExpiredDataExports,
);

crons.interval(
  'recover overdue internal trial expirations',
  { minutes: 5 },
  internal.subscriptions.expireOverdueInternalTrials,
);

export default crons;
