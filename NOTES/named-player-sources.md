# Named-player source audit — 2026-11-04

Metadata-only research, sequential yt-dlp calls; six per-video checks, no media downloads.
Full-game evidence is uploader metadata, not an end-to-end footage audit.

## Accepted: @beifengQiyana

https://www.youtube.com/channel/UC8_CJP1lfMjzGo_jkMW8SQg/videos
Channel description: "BeiFeng Qiyana fan.Authorized by BeiFeng and Ye QiuFeng. I will be updating the latest full game videos on this channel."
Authorization is an uploader claim, not independently verified.
394 uploads listed in full; recent titles also feature Jiefangzhigu, deliberately not in this curated registry.
Samples (all playable_in_embed=true):
- Hb-rudr99P8, 2026-08-24, 1365s: BeiFeng Qiyana vs Viktor — Challenger CN Super Server — Engsub
- eXCfwPwBR2U, 2026-05-10, 1233s: BeiFeng Qiyana vs Veigar — Challenger CN Super Server — Engsub
- u9YF2k2aLqo, 2026-05-29, 1446s: BeiFeng Qiyana vs Zoe — Challenger CN Super Server — Engsub
Each has one matchup, game-length duration, no edited-content marker, and channel-level full-game evidence.
Named sources require explicit embed=true before publishing. Exact detail dates drive the existing patch estimate; no CN region is emitted into the schema.

## Deferred / rejected

- LoL Challenger CN (UCnHjebgvo2inKO9LxiZ3qlw): prior live research newest season 14.22 and sampled exact date 2024-11-12, fails date/patch floor. Not approved.
- XIAO CHAO MENG LOL (UC0LfrLWI2wAFLK_9kqyupjw): prior research description explicitly says highlight collection; reject even though sample was 1807s and embed=true.
- UCwuKE9d8VMdE1RniwUYnIVg: searched BeiFeng full game lead; newest flat titles omit opponents, no channel description/full-game claim; not added.
- Naayil own channel: prior specialist research has editor credits and inconsistent matchup fields, no verified full-game/embed evidence; not added.

CN verdict: one newly established metadata-qualified full-game source for Beifeng, not broad coverage of XiaoMing, Xiao Chao Meng, Softwind, HanQL or Mangofish. Registry presence is not a claim of available VODs. No estimates from stale or highlights channels are included.

## Accepted by maintainer curation: @xiaomingaatrox — 2026-11-04

UCBnsdnhdPysrE0JCjQPn-QA is approved with listing durations 900–2700 seconds,
required champion/opponent, edited/funny-title rejection, and same-channel normalized
title + matchup repeats within five seconds keeping the earliest upload. Emoji and
punctuation are ignored for repeat comparison. Lane defaults to registry top only
when absent; rank defaults to Master+, and KR requires title evidence.
Exact detail upload date drives the existing patch estimator (floor 25.1);
explicit embed=true is required. The existing full-game continuity uncertainty
remains: this is maintainer-approved metadata curation, not a footage audit.
This approval supersedes the earlier deferral and section 2D of vod-volume-research.md.
