import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('cleanup stale pending uploads', { minutes: 15 }, internal.comments.cleanupStalePendingUploads);

export default crons;
