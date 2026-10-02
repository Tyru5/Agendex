# Team review requests

Cloud workspace owners can request a review of a published plan from current workspace members. Open a cloud plan, expand **Team review**, select up to ten reviewers, and add an optional message. Add reviewers through the existing workspace settings first. A reviewer cannot review their own plan; an outside-workspace user cannot be assigned.

Use **Reviews** in the cloud topbar to open the review inbox. **Assigned to me** shows requests to review; **Requested by me** shows the owner's requests and decisions. Unread updates are marked in loaded pages. Open the plan to inspect its content, then approve the displayed revision or request changes with a note. The owner can cancel a pending request. Load older reviews to walk the complete history.

Each request binds the plan's version and an exact SHA-256 fingerprint of its title, body, and format. A changed revision supersedes the previous review, including when an older version's content is restored. Approval applies only to that requested revision. Duplicate requests are retry-safe and never reset an existing decision. After cancelling a request, the owner can send a fresh request.

Membership and plan visibility are checked on every read and mutation. Removing a reviewer cancels that assignment; removing and re-adding the same person does not revive it. Hidden or deleted plans do not appear in inboxes. An inactive workspace subscription revokes access. Public and password-protected share links do not authorize team review decisions, regardless of link lifetime. Invited reviewers do not need their own subscription. Their read/pin markers are saved locally; personal tags and collections remain restricted to their subscriber owner.

Notifications stay inside Agendex. Team review decisions are advisory and do not resume a local agent or replace an agent permission gate. Request history and assigned reviews are included in account exports and are removed during plan/account deletion.

## Backend surface

The `teamReviews` Convex module exposes `eligibleReviewers`, `request`, `forPlan`, `inbox`, `decide`, `cancel`, and `markRead`. Queries use indexed cursor pagination. Review pages hold at most five entries to stay below read-size limits when plans approach Convex's document limit; the client loads older pages on demand. Request and decision notes are limited to 4,000 characters.

The stored states are `pending`, `approved`, `changes_requested`, and `cancelled`. Reads also derive `superseded` from the current revision and derive `cancelled` if the original membership was removed. These effective states prevent stale decisions even before any cleanup job runs. Approval is not transferred between revisions.
