import { Competition } from '../types'
export const demoCompetitions: Competition[] = [
  { id: 'ph-123', title: 'Side Project Saturday — Sticker Pack Giveaway', source: 'Product Hunt / Discussion', link: 'https://www.producthunt.com/discussions', prize: 'Sticker Pack', deadline: '2025-12-31', tags: ['stickers','community'], createdAt: new Date().toISOString() },
  { id: 'tw-456', title: 'X (Twitter) Contest — Best Launch Thread', source: 'X / #buildinpublic', link: 'https://x.com', prize: '$100 gift card', deadline: '2025-10-30', tags: ['twitter','launch'], createdAt: new Date(Date.now()-86400000).toISOString() },
  { id: 'rd-789', title: 'Reddit r/SideProject — Monthly Showcase', source: 'Reddit', link: 'https://www.reddit.com/r/SideProject/', prize: 'Top Post Flair', deadline: '2025-10-15', tags: ['reddit','showcase'], createdAt: new Date(Date.now()-2*86400000).toISOString() },
]