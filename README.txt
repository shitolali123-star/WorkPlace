Work Place — Full Website Model v1

Included:
- Existing email OTP/login/signup/profile photo backend foundation
- Job posting and finding
- Worker profiles
- Current Situation
- Appeals
- Payments + SSLCOMMERZ integration foundation
- Advertisement packages + review workflow UI
- Entertainment UI: For You, Following, Shorts, Live, Trending, video actions, right-side ad panel
- Coin & Rewards UI: daily check-in, 60-day cycle concept, level progress
- Admin Control Center: users, jobs, appeals, payments, ads, entertainment, coins, analytics, settings, audit logs

IMPORTANT:
This release is a combined model/prototype, not a production-ready social/video/reward platform. Entertainment feeds, creator uploads, live streaming, recommendation algorithm, ad delivery, real coin ledger, cash withdrawal, moderation automation and full admin APIs still need backend implementation, security hardening, policy/legal review and third-party service configuration.

Do not upload .env or secrets to GitHub.


Latest UI/auth update:
- Login now has Forgot Password.
- Sign Up collects Account Type, Country, Date of Birth, profile photo and aligned identity fields.
- Create Account starts email verification; the account is created only after verification on verify-email.html.
- Password reset uses email OTP.
- Entertainment demo UI now has search, feed/type filters and working demo actions.
- Entertainment remains a prototype until real video/content, creator, moderation, recommendation, reward ledger and ad delivery backends are implemented.

LATEST UPDATE — Entertainment + Coin UI
- Entertainment navigation is now a vertical left sidebar: For You, Following, Shorts, Long Videos, Live, Trending and Saved Videos.
- Saved Videos can be opened from the Saved Videos section.
- Active-watch reward progress appears directly below the Entertainment advertisement. It fills automatically while a video is actively playing. Default rate: 10 seconds = 1 coin.
- Admin Control Center has prototype controls for active-watch seconds/coin, daily sign-in coins, coins-per-BDT conversion and minimum withdrawal.
- Dashboard navigation has a small coin icon immediately to the right of Appeals. It opens Coin & Rewards.
- Coin & Rewards includes daily sign-in claim, current balance, daily rate, conversion value and withdrawal request UI.
- Real cash payout is not automatic in this prototype; withdrawal requests are recorded locally for Admin review. A production payout provider/business banking setup and secure authentication are required before real-money withdrawals.

Entertainment sidebar update (latest): Teaching, Liked Videos, History and Your Channel were added. Liked/History are prototype localStorage features; final production version should store these server-side per authenticated user.


LATEST UPDATE: full UI workflow for job media, accepted-job cancellation lock, deadline auto-cancel, appeal evidence, 60-day admin coin schedule, support settings, branded coin, creator channels, video posting, teaching/liked/history, and monetisation application/review model.

V5 UPDATE NOTES
Home now has a top-right Create & Share area with Post Video, Post Reels, Post Teaching Video and Go Live. A live-room prototype supports category metadata and active live listings. Admin Coins & Rewards now includes a 30-day daily sign-in reward editor. Day 30 cycles back to Day 1; missing a day resets the next sign-in to Day 1.
