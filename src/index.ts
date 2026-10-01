#!/usr/bin/env node

import { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import axios from 'axios'

const DISCOURSE_API_BASE = process.env.DISCOURSE_API_BASE
const USER_API_KEY = process.env.USER_API_KEY
if (!DISCOURSE_API_BASE || !USER_API_KEY) {
    process.exit(1)
}

axios.defaults.headers.common['User-Api-Key'] = USER_API_KEY
const toolname = (name?: string): string => 'discourse' + (name ? '_' + name : '')
const discourse = (path: string, params?: Record<string, any>) => {
    const url = new URL(DISCOURSE_API_BASE)
    url.pathname = path

    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            Array.isArray(v)
                ? v.forEach(item => {
                      url.searchParams.append(k, item)
                  })
                : url.searchParams.set(k, v)
        })
    }

    return url.toString()
}

const server = new McpServer({
    name: toolname(),
    version: '1.0.0'
})

const toolrun =
    <T extends Record<string, any>>(fn: (args: T) => Promise<string>) =>
    async (args: T): Promise<CallToolResult> => {
        try {
            return { content: [{ type: 'text', text: await fn(args) }] }
        } catch (error) {
            const body = axios.isAxiosError(error) ? error.response?.data : null
            return { content: [{ type: 'text', text: JSON.stringify(body ?? { error: String(error) }) }], isError: true }
        }
    }

server.registerTool(
    toolname('whoami'),
    {
        description: 'retrieve discourse user information'
    },
    toolrun(async () => {
        const resp = await axios.get(discourse('session/current.json'))
        const current_user = resp.data.current_user
        return `userid: ${current_user.id}, username: ${current_user.username}, nickname: ${current_user.name}`
    })
)

server.registerTool(
    toolname('user_info'),
    {
        description: 'retrieve specified user information from discourse',
        inputSchema: z.object({
            username: z.string().describe('discourse username')
        })
    },
    toolrun(async ({ username }) => {
        const resp = await axios.get(discourse(`u/${username}.json`))
        const user = resp.data.user
        return `userid: ${user.id}, username: ${user.username}, nickname: ${user.name}`
    })
)

server.registerTool(
    toolname('latest_topic'),
    {
        description: 'retrieve the list of latest topics; supports pagination',
        inputSchema: z.object({
            page: z.number().min(0).optional().default(0).describe('page number, 0-based index')
        })
    },
    toolrun(async ({ page }) => {
        const resp = await axios.get(discourse('latest.json', { page }))
        const topics = resp.data.topic_list.topics
        return `current page number: ${page}, next page number: ${page + 1}, topics: ${JSON.stringify(topics)}`
    })
)

server.registerTool(
    toolname('hot_topic'),
    {
        description: 'retrieve the list of hot topics; supports pagination',
        inputSchema: z.object({
            page: z.number().min(0).optional().default(0).describe('page number, 0-based index')
        })
    },
    toolrun(async ({ page }) => {
        const resp = await axios.get(discourse('top.json', { page }))
        const topics = resp.data.topic_list.topics
        return `current page number: ${page}, next page number: ${page + 1}, topics: ${JSON.stringify(topics)}`
    })
)

server.registerTool(
    toolname('list_topic_posts'),
    {
        description: 'list all posts under a specific topic and return an array of post ids, with the first element (index 0) being the topic itself',
        inputSchema: z.object({
            id: z.number().min(0).describe('topic id')
        })
    },
    toolrun(async ({ id }) => {
        const resp = await axios.get(discourse(`t/topic/${id}.json`))
        const postids = resp.data.post_stream.stream
        return JSON.stringify(postids)
    })
)

server.registerTool(
    toolname('read_post'),
    {
        description: 'retrieve detailed information for a specific post',
        inputSchema: z.object({
            id: z.number().min(0).describe('post id')
        })
    },
    toolrun(async ({ id }) => {
        const resp = await axios.get(discourse(`posts/${id}.json`))
        return JSON.stringify(resp.data)
    })
)

server.registerTool(
    toolname('read_post_batch'),
    {
        description: 'batch retrieve posts under a specified topic',
        inputSchema: z.object({
            topicid: z.number().min(0).describe('topic id'),
            postids: z.array(z.number().min(0).describe('post id')).describe('post id array')
        })
    },
    toolrun(async ({ topicid, postids }) => {
        const resp = await axios.get(discourse(`t/${topicid}/posts.json`, { 'post_ids[]': postids }))
        return JSON.stringify(resp.data.post_stream.posts)
    })
)

server.registerTool(
    toolname('search'),
    {
        description: 'site search with pagination support',
        inputSchema: z.object({
            query: z.string().describe('search keyword'),
            page: z.number().min(1).optional().default(1).describe('page number, 1-based index')
        })
    },
    toolrun(async ({ query, page }) => {
        const resp = await axios.get(discourse('search.json', { q: query, page }))
        const posts = resp.data.posts
        return `current page number: ${page}, next page number: ${page + 1}, posts: ${JSON.stringify(posts)}`
    })
)

server.registerTool(
    toolname('read_notifications'),
    {
        description: 'retrieve notification information; supports pagination',
        inputSchema: z.object({
            offset: z.number().min(0).optional().default(0).describe('notification starting point, 0-based index'),
            limit: z.number().min(1).optional().default(1).describe('number of notifications'),
            filter: z
                .union([z.literal('read'), z.literal('unread')])
                .optional()
                .default('unread')
                .describe('filter by reading status'),
            filter_by_types: z
                .array(z.enum(['mentioned', 'replied']))
                .min(1)
                .optional()
                .default(['mentioned', 'replied'])
                .describe('notification type filtering')
        })
    },
    toolrun(async ({ offset, limit, filter, filter_by_types }) => {
        const resp = await axios.get(discourse('notifications.json', { offset, limit, filter, filter_by_types: filter_by_types.join(',') }))
        const notifications = resp.data.notifications
        return JSON.stringify(notifications)
    })
)

server.registerTool(
    toolname('mark_all_notifications_read'),
    {
        description: 'mark all notifications as read'
    },
    toolrun(async () => {
        const resp = await axios.put(discourse('notifications/mark-read.json'), {})
        return JSON.stringify(resp.data)
    })
)

server.registerTool(
    toolname('mark_notifications_read'),
    {
        description: 'mark a single notification as read',
        inputSchema: z.object({
            id: z.number().min(0).describe('notification id')
        })
    },
    toolrun(async ({ id }) => {
        const resp = await axios.put(discourse('notifications/mark-read.json'), { id })
        return JSON.stringify(resp.data)
    })
)

server.registerTool(
    toolname('reply'),
    {
        description: 'reply to the topic',
        inputSchema: z.object({
            content: z.string().describe('reply content'),
            topicid: z.number().min(0).describe('topic id'),
            reply_to_post_number: z.number().min(0).optional().describe('the post number when replying to a specific post')
        })
    },
    toolrun(async ({ content, topicid, reply_to_post_number }) => {
        const resp = await axios.post(discourse('posts.json'), { raw: content, topic_id: topicid, reply_to_post_number })
        return JSON.stringify(resp.data)
    })
)

server.registerTool(
    toolname('edit'),
    {
        description: 'edit post',
        inputSchema: z.object({
            id: z.number().min(0).describe('post id'),
            content: z.string().describe('revised content'),
            edit_reason: z.string().optional().describe('reason for modification')
        })
    },
    toolrun(async ({ id, content, edit_reason }) => {
        const resp = await axios.put(discourse(`posts/${id}.json`), { raw: content, edit_reason })
        return JSON.stringify(resp.data)
    })
)

const main = async () => {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('discourse mcp server running on stdio')
}

main().catch(error => {
    console.error('fatal error in main():', error)
    process.exit(1)
})
