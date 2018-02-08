// see the stride API
// https://developer.stg.internal.atlassian.com/cloud/stride/rest/

const request = require('request')
const jwtUtil = require('jwt-simple')

const prettyjson = require('prettyjson');
function prettify_json(data, options = {}) {
  return '{\n' + prettyjson.render(data, options) + '\n}'
}

function factory({clientId, clientSecret, env = 'development', debugId = 'stride.js', logger = console}) {
  const API_BASE_URL = env === "production" ? 'https://api.atlassian.com' : 'https://api.stg.atlassian.com'

  // a light async wrapper around request
  function r2(options) {
    let logDetails = {
      request: options
    }

    return new Promise((resolve, reject) => {
      logger.info(`- ${debugId}: requesting...` + options.method + '/' + options.uri)

      request(options, (err, response, body) => {
        if (err) {
          logger.error(`! ${debugId}: request failed! details =`, prettify_json({logDetails, err}))
          return reject(err)
        }

        if (!response || response.statusCode >= 399) {
          logger.error(`! ${debugId}: request failed with an error response! details =`, prettify_json({logDetails, responseBody: response.body, err}))
          return reject(new Error('Request failed'))
        }

        resolve(body)
      })
    })
  }

  /**
   * Get an access token from the Atlassian Identity API
   */
  let token = null
  let accessTokenPromise = null
  async function getAccessToken() {
    if (token && Date.now() <= token.refresh_time) {
      // Reuse the cached token if any
      return token.access_token
    }

    if (accessTokenPromise) {
      // a request for a token is in-flight, don't duplicate it
      return accessTokenPromise
    }

    // Generate a new token
    const request_options = {
      uri: API_BASE_URL + '/oauth/token',
      method: 'POST',
      json: {
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      }
    }

    accessTokenPromise = r2(request_options)
      .then(newToken => {
        logger.info(`- ${debugId}/getAccessToken(): got a token` /*, prettify_json(token)*/)

        // remember to refresh the token a minute before it expires (tokens last for an hour)
        newToken.refresh_time = Date.now() + (newToken.expires_in - 60) * 1000
        token = newToken;

        // The promise is now getting resolved so set it to null again to allow future
        // requests to go through
        accessTokenPromise = null;

        return token.access_token
      })

    return accessTokenPromise
  }


  /**
   * Functions to call the Stride API
   */

  /** Send a message formatted in the Atlassian JSON format
   * see https://developer.atlassian.com/cloud/stride/apis/document/structure/
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-conversationId-message-post
   */
  async function sendMessage({cloudId, conversationId, document}) {
    if (!cloudId)
      throw new Error('Stride/sendMessage: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/sendMessage: missing param conversationId!')
    if (!document)
      throw new Error('Stride/sendMessage: missing param documentMessage!')
    if (!document.content || !Array.isArray(document.content))
      throw new Error('Stride/sendMessage: wrong message format!')

    const accessToken = await getAccessToken()
    const uri = API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/message'
    const options = {
      uri,
      method: 'POST',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      },
      json: {
        body: document
      }
    }

    return r2(options)
  }

  async function updateMessage({cloudId, conversationId, messageId, document}) {
    console.log(messageId);
    if (!cloudId)
      throw new Error('Stride/sendMessage: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/sendMessage: missing param conversationId!')
    if (!messageId)
      throw new Error('Stride/sendMessage: missing param messageId!')
    if (!document)
      throw new Error('Stride/sendMessage: missing param document!')
    if (!document.content || !Array.isArray(document.content))
      throw new Error('Stride/sendMessage: wrong message format!')

    const accessToken = await getAccessToken()
    const uri = API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/message/' + messageId
    const options = {
      uri,
      method: 'PUT',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      },
      json: {
        body: document
      }
    }

    return r2(options)
  }

  /** Send a private message to a user
   * To do this, you must first get the conversation Id for this user.
   * Doing this will, behind the scenes, initiates a conversation with the user and install the app in that conversation.
   * If that endpoint fails (which can happen if the app installation takes too long (e.g. >5 seconds),
   * you should try again until it succeeds with a 200.
   * Note: you only need to do this once per user.
   *
   * Then, to send the message, you can either use one of the 2 following endpoints:
   *  /site/{siteId}/conversation/{conversationId}/message
   * /site/{siteId}/conversation/user/{userId}/messag
   * Both will work.
   */
  async function sendPrivateMessage({cloudId, userId, document}) {
    if (!cloudId)
      throw new Error('Stride/sendPrivateMessage: missing param cloudId!')
    if (!userId)
      throw new Error('Stride/sendPrivateMessage: missing param userId!')
    if (!document)
      throw new Error('Stride/sendPrivateMessage: missing param documentMessage!')
    if (!document.content || !Array.isArray(document.content))
      throw new Error('Stride/sendPrivateMessage: wrong message format!')

    const accessToken = await getAccessToken()

    const getUserConversationOptions = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/user/' + userId,
      method: 'GET',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }
    var conversation = await r2(getUserConversationOptions).then(JSON.parse)

    if(conversation.id) {

      const sendMessageOptions = {
        uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversation.id + '/message',
        method: 'POST',
        headers: {
          authorization: "Bearer " + accessToken,
          "cache-control": "no-cache"
        },
        json: {
          body: document
        }
      }

      return r2(sendMessageOptions)
    } else {
      throw new Error('Error getting details about the direct conversation')
    }

  }

  /** Get infos about a conversation/room
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-conversationId-get
   */
  async function getConversation({cloudId, conversationId}) {
    if (!cloudId)
      throw new Error('Stride/getConversation: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/getConversation: missing param conversationId!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId,
      method: 'GET',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }

    return r2(options)
      .then(JSON.parse)
  }

  /* Create a room/conversation
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-post
   */
  async function createConversation({cloudId, name, privacy = 'public', topic = ''}) {
    if (!cloudId)
      throw new Error('Stride/createConversation: missing param cloudId!')
    if (!name)
      throw new Error('Stride/createConversation: missing param name!')

    const accessToken = await getAccessToken()
    const body = {
      name,
      privacy,
      topic,
    }
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation',
      method: 'POST',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      },
      json: body
    }

    return r2(options)
  }

  /**
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-conversationId-archive-put
   */
  async function archiveConversation({cloudId, conversationId}) {
    if (!cloudId)
      throw new Error('Stride/archiveConversation: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/archiveConversation: missing param conversationId!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/archive',
      method: 'PUT',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }

    return r2(options)
  }

  /**
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-conversationId-message-get
   */
  async function getConversationHistory({cloudId, conversationId}) {
    if (!cloudId)
      throw new Error('Stride/getConversationHistory: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/getConversationHistory: missing param conversationId!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + "/message?limit=5",
      method: 'GET',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }

    return r2(options)
      .then(JSON.parse)
  }

  /**
   * https://developer.atlassian.com/cloud/stride/apis/rest/#api-site-cloudId-conversation-conversationId-roster-get
   */
  async function getConversationRoster({cloudId, conversationId}) {
    if (!cloudId)
      throw new Error('Stride/getConversationRoster: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/getConversationRoster: missing param conversationId!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + "/roster",
      method: 'GET',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }

    return r2(options)
      .then(JSON.parse)
  }

  /**
   * Send a file to a conversation. you can then include this file when sending a message
   */
  async function sendMedia({cloudId, conversationId, name, stream}) {
    if (!cloudId)
      throw new Error('Stride/sendMedia: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/sendMedia: missing param conversationId!')
    if (!name)
      throw new Error('Stride/sendMedia: missing param name!')
    if (!stream)
      throw new Error('Stride/sendMedia: missing param stream!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/media?name=' + name,
      method: 'POST',
      headers: {
        authorization: "Bearer " + accessToken,
        'content-type': 'application/octet-stream'
      },
      body: stream
    }

    return r2(options)
  }

  /**
   * Update the "glance state" displayed on the right panel and button
   */
  async function updateGlanceState({cloudId, conversationId, glanceKey, stateTxt}) {
    if (!cloudId)
      throw new Error('Stride/updateGlanceState: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/updateGlanceState: missing param conversationId!')
    if (!glanceKey)
      throw new Error('Stride/updateGlanceState: missing param glanceKey!')
    if (!stateTxt)
      throw new Error('Stride/updateGlanceState: missing param stateTxt!')

    const accessToken = await getAccessToken()
    const uri = API_BASE_URL + '/app/module/chat/conversation/chat:glance/' + glanceKey + '/state'
    const options = {
      uri,
      method: 'POST',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      },
      json: {
        "context": {
          cloudId,
          conversationId,
        },
        "label": stateTxt,
        "metadata": {}
      }
    }

    return r2(options)
  }

  /**
   * TODO doc
   */
  async function updateConfigurationState({cloudId, conversationId, configKey, state}) {
    if (!cloudId)
      throw new Error('Stride/updateConfigurationState: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/updateConfigurationState: missing param conversationId!')
    if (!configKey)
      throw new Error('Stride/updateConfigurationState: missing param configKey!')
    if (!state)
      throw new Error('Stride/updateConfigurationState: missing param state!')

    const accessToken = await getAccessToken()
    const uri = API_BASE_URL + '/app/module/chat/conversation/chat:configuration/' + configKey + '/state'
    const options = {
      uri: uri,
      method: 'POST',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      },
      json: {
        "context": {
          cloudId,
          conversationId,
        },
        "configured": state
      }
    }

    return r2(options)
  }

  /**
   * Atlassian Users API
   */
  async function getUser({cloudId, userId}) {
    if (!cloudId)
      throw new Error('Stride/getUser: missing param cloudId!')
    if (!userId)
      throw new Error('Stride/getUser: missing param userId!')

    const accessToken = await getAccessToken()
    const options = {
      uri: API_BASE_URL + '/scim/site/' + cloudId + '/Users/' + userId,
      method: 'GET',
      headers: {
        authorization: "Bearer " + accessToken,
        "cache-control": "no-cache"
      }
    }

    return r2(options)
      .then(JSON.parse)
  }

  /**
   * Utility functions
   */

  async function sendTextMessage({cloudId, conversationId, text}) {
    if (!cloudId)
      throw new Error('Stride/sendTextMessage: missing param cloudId!')
    if (!conversationId)
      throw new Error('Stride/sendTextMessage: missing param conversationId!')
    if (!text)
      throw new Error('Stride/sendTextMessage: missing param text!')

    return sendMessage({cloudId, conversationId, document: convertTextToDoc(text)})
  }

  /**
   * Create a "document" containing a mention
   * @param text: ex. "Beware {{MENTION}}, I know where you live..."
   */
  async function createDocMentioningUser({cloudId, userId, text}) {
    if (!cloudId)
      throw new Error('Stride/sendTextMessageMentioningUser: missing param cloudId!')
    if (!userId)
      throw new Error('Stride/sendTextMessageMentioningUser: missing param userId!')
    if (!text)
      throw new Error('Stride/sendTextMessageMentioningUser: missing param text!')

    const user = await getUser({cloudId, userId})

    const mention = {
      type: "mention",
      attrs: {
        id: user.id,
        text: user.displayName,
      }
    }

    const paragraphContent = []
    const msgParts = text.split('{{MENTION}}')
    if (msgParts.length > 1) {
      paragraphContent.push({
        type: "text",
        text: msgParts.shift(),
      })
    }

    while(msgParts.length) {
      paragraphContent.push(mention)
      paragraphContent.push({
        type: "text",
        text: msgParts.shift(),
      })
    }

    const document = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: paragraphContent,
        },
      ],
    }

    return document
  }

  async function reply({reqBody, document}) {
    if (!reqBody)
      throw new Error('Stride/reply: missing param reqBody!')
    if (!document)
      throw new Error('Stride/reply: missing param document!')
    if (!document.content || !Array.isArray(document.content))
      throw new Error('Stride/reply: wrong message format!')

    const cloudId = reqBody.cloudId
    const conversationId = reqBody.conversation.id

    return sendMessage({cloudId, conversationId, document})
  }

  async function replyWithText({reqBody, text}) {
    if (!reqBody)
      throw new Error('Stride/replyWithText: missing param reqBody!')
    if (!text)
      throw new Error('Stride/replyWithText: missing param text!')

    const cloudId = reqBody.cloudId
    const conversationId = reqBody.conversation.id

    return sendTextMessage({cloudId, conversationId, text})
  }

  /**
   * Convert an Atlassian document to plain text
   * see https://developer.atlassian.com/cloud/stride/apis/document/structure/
   * Note: useless since we have that in message.text
   */
  async function convertDocToText(document) {
    if (!document)
      throw new Error('Stride/convertDocToText: missing param document!')
    if (!document.content || !Array.isArray(document.content))
      throw new Error('Stride/convertDocToText: wrong format!')

    const accessToken = await getAccessToken()

    const options = {
      uri: API_BASE_URL + '/pf-editor-service/render',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/plain',
        authorization: "Bearer " + accessToken
      },
      json: document
    }

    return r2(options)
  }

  function convertTextToDoc(text) {
    if (!text)
      throw new Error('Stride/convertTextToDoc: missing param text!')

    return {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      ],
    }
  }

  async function convertMarkdownToDoc(markdown) {

    const accessToken = await getAccessToken()

    const options = {
      uri: API_BASE_URL + '/pf-editor-service/convert?from=markdown&to=adf',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: "Bearer " + accessToken
      },
      json: {input: markdown}
    }

    return r2(options)

  }

  /**
   * Securing your app with JWT
   * --------------------------
   * Whenever Stride makes a call to your app (webhook, glance, sidebar, bot), it passes a JSON Web Token (JWT).
   * This token contains information about the context of the call (cloudId, conversationId, userId)
   * This token is signed, and you should validate the signature, which guarantees that the call really comes from Stride.
   * You validate the signature using the app's client secret.
   *
   * In this tutorial, the token validation is implemented as an Express middleware function which is executed
   * in the call chain for every request the app receives from Stride.
   * The function extracts the context of the call from the token and adds it to a local variable.
   */

  function getJWT(req) {
    // Extract the JWT token from the request
    // Either from the "jwt" request parameter
    // Or from the "authorization" header, as "Bearer xxx"
    var encodedJwt = req.query['jwt']
      || req.headers['authorization'].substring(7)
      || req.headers['Authorization'].substring(7)

    //TEMP FIX FOR BUG
    if (req.headers['authorization'] && !req.headers['authorization'].startsWith('Bearer'))
      encodedJwt = req.headers['authorization'];

    if  (!encodedJwt)
      throw new Error('Stride/getJWT: expected encoded JWT not found!')

    // Decode the base64-encoded token, which contains the context of the call
    const decodedJwt = jwtUtil.decode(encodedJwt, null, true)

    const jwt = {encoded: encodedJwt, decoded: decodedJwt}

    logger.log(`- ${debugId}/getJWT() got JWT`/*, prettify_json(jwt)*/)

    return jwt
  }

  function validateJWT(req, res, next) {
    let logDetails = {
      debugId,
      endpoint: req.path,
      method: req.method,
    }

    try {
      const jwt = getJWT(req)

      logger.log(`- ${debugId}/validating JWT...`)

      // Validate the token signature using the app's OAuth secret (created in DAC App Management)
      // (to ensure the call comes from Stride)
      jwtUtil.decode(jwt.encoded, clientSecret)

      // all good, it's from Stride
      logger.info(`- ${debugId}: JWT valid`/*, prettify_json({...logDetails})*/)

      // if any, add the context to a local variable
      const conversationId = jwt.decoded.context.resourceId
      const cloudId = jwt.decoded.context.cloudId
      const userId = jwt.decoded.sub

      logDetails = {
        logDetails,
        cloudId,
        conversationId,
        userId,
      }
      res.locals.context = {cloudId, conversationId, userId};

      // Continue with the rest of the call chain
      next()
    } catch (err) {
      logger.warn(`! ${debugId}: Invalid JWT:` + err.message, prettify_json({logDetails, err}))
      // a rogue call not frow a legitimate Stride client?
      res.sendStatus(403)
    }
  }

  return {
    getAccessToken,

    sendMessage,
    sendPrivateMessage,
    updateMessage,

    getConversation,
    createConversation,
    archiveConversation,
    getConversationHistory,
    getConversationRoster,

    sendMedia,
    updateGlanceState,
    updateConfigurationState,

    getUser,

    // utilities
    sendTextMessage,
    createDocMentioningUser,
    reply,
    replyWithText,
    convertDocToText,
    convertTextToDoc,
    convertMarkdownToDoc,
    r2,

    // middlewares
    validateJWT,
  }
}


module.exports = {
  factory,
}
