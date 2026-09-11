// Helpers for pulling a creator's channel/video data from the YouTube API.
// Kept separate from server/index.js so the sync logic is easy to test and
// reuse from both the sync endpoint and any future background job.

export async function fetchUploadsPlaylistId(youtube, channelId) {
  const response = await youtube.channels.list({ id: [channelId], part: ['contentDetails'] })
  return response.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
}

// Paginates through the channel's uploads playlist to list every video.
export async function fetchAllChannelVideos(youtube, uploadsPlaylistId) {
  const videos = []
  let pageToken
  do {
    const response = await youtube.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ['snippet', 'contentDetails'],
      maxResults: 50,
      pageToken,
    })
    for (const item of response.data.items || []) {
      videos.push({
        id: item.contentDetails?.videoId,
        title: item.snippet?.title || 'Untitled video',
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null,
      })
    }
    pageToken = response.data.nextPageToken
  } while (pageToken)
  return videos.filter((video) => video.id)
}

// Batches videos.list calls (max 50 IDs per request) to fetch total comment counts.
export async function fetchVideoCommentCounts(youtube, videoIds) {
  const counts = new Map()
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const response = await youtube.videos.list({ id: batch, part: ['statistics'] })
    for (const item of response.data.items || []) {
      counts.set(item.id, Number(item.statistics?.commentCount || 0))
    }
  }
  return counts
}

// Pulls one page of the most recent comment threads for a video, used as a
// representative sample for priority scoring (not a full historical fetch).
// Returns [] instead of throwing when comments are disabled/unavailable.
export async function fetchRecentCommentThreads(youtube, videoId, maxResults = 100) {
  try {
    const response = await youtube.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults,
      order: 'time',
      textFormat: 'plainText',
    })
    return response.data.items || []
  } catch (error) {
    const isQuota = /quota/i.test(error.message || '') || error.errors?.some((e) => /quota/i.test(e.reason || ''))
    if (isQuota) throw error
    if (error.code === 403 || error.code === 404) return [] // comments disabled or video not found
    throw error
  }
}

// Shapes a raw commentThreads.list response into the flat comment records
// used throughout the app (classification, storage, display).
export function normalizeThreads(items) {
  return items.map((item, index) => {
    const snippet = item.snippet?.topLevelComment?.snippet || {}
    const replyCount = Number(item.snippet?.totalReplyCount || 0)
    return {
      id: item.id || `youtube-${index}`,
      parentId: item.snippet?.topLevelComment?.id || item.id,
      name: snippet.authorDisplayName || 'YouTube viewer',
      initials: (snippet.authorDisplayName || 'YT').replace(/[^A-Za-z ]/g, '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      time: snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString() : 'recently',
      publishedAt: snippet.publishedAt || null,
      text: snippet.textOriginal || snippet.textDisplay || '',
      likes: snippet.likeCount || 0,
      replyCount,
      isReplied: replyCount > 0,
    }
  })
}
