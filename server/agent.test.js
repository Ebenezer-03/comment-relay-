import { describe, it, expect } from 'vitest'
import { createTriageAgent, runCommunityTriageAgent } from './agent.js'
import { DEFAULT_CATEGORIES } from './classify.js'

describe('Strands Community Triage Agent', () => {
  const fakeVideo = {
    id: 'vid1',
    creatorId: 'UC_test',
    title: 'Building Production AI Agents with Strands SDK',
    publishedAt: new Date(),
  }

  const contextMap = new Map([
    ['install', 'Make sure node version is >= 20. Run npm install @strands-agents/sdk.'],
  ])

  it('constructs a Strands Agent with required tools', () => {
    const agent = createTriageAgent({
      video: fakeVideo,
      categories: DEFAULT_CATEGORIES,
      contextByPack: contextMap,
    })

    expect(agent).toBeDefined()
    // Strands Agent exposes toolRegistry or tools
    const toolNames = agent.tools ? agent.tools.map((t) => t.name) : []
    expect(toolNames).toContain('lookupContext')
    expect(toolNames).toContain('draftReply')
    expect(toolNames).toContain('escalateDecision')
  })

  it('lookupContext tool returns creator notes and category information', async () => {
    let capturedDraft = null
    let capturedEscalation = null

    const agent = createTriageAgent({
      video: fakeVideo,
      categories: DEFAULT_CATEGORIES,
      contextByPack: contextMap,
      onDraft: (pack, draft) => { capturedDraft = { pack, draft } },
      onEscalate: (item) => { capturedEscalation = item },
    })

    const lookup = agent.tools.find((t) => t.name === 'lookupContext')
    const resultJson = await lookup.invoke({ packId: 'install' })
    const result = JSON.parse(resultJson)

    expect(result.packId).toBe('install')
    expect(result.creatorContext).toContain('node version is >= 20')
  })

  it('escalateDecision tool triggers human-in-the-loop escalation', async () => {
    let capturedEscalation = null

    const agent = createTriageAgent({
      video: fakeVideo,
      categories: DEFAULT_CATEGORIES,
      contextByPack: contextMap,
      onEscalate: (item) => { capturedEscalation = item },
    })

    const escalate = agent.tools.find((t) => t.name === 'escalateDecision')
    const resultJson = await escalate.invoke({
      commentId: 'c123',
      authorName: 'AlexDev',
      commentText: 'The code throws a TypeError on line 42 with Node 22',
      urgencyReason: 'Potential breaking bug in video repository',
      recommendedAction: 'Verify compatibility and update readme notes',
    })

    expect(JSON.parse(resultJson).escalated).toBe(true)
    expect(capturedEscalation).toBeDefined()
    expect(capturedEscalation.commentId).toBe('c123')
    expect(capturedEscalation.urgencyReason).toContain('Potential breaking bug')
  })

  it('draftReply tool triggers answer pack draft callback', async () => {
    let capturedDraft = null

    const agent = createTriageAgent({
      video: fakeVideo,
      categories: DEFAULT_CATEGORIES,
      contextByPack: contextMap,
      onDraft: (pack, draft) => { capturedDraft = { pack, draft } },
    })

    const draftTool = agent.tools.find((t) => t.name === 'draftReply')
    await draftTool.invoke({
      packId: 'install',
      categoryLabel: 'Install error',
      draft: 'Thanks for bringing this up! If you hit an install error, verify your Node version is 20+.',
    })

    expect(capturedDraft).toEqual({
      pack: 'install',
      draft: 'Thanks for bringing this up! If you hit an install error, verify your Node version is 20+.',
    })
  })
})
