import { getBase64Async } from "../../utils.js";
import { extension_settings, getContext, getApiUrl } from "../../extensions.js";
import {
    chat,
    is_send_press,
    saveSettingsDebounced,
} from "../../../script.js";

export { MODULE_NAME };

const MODULE_NAME = 'reddit';
const UPDATE_INTERVAL = 1000;
const MINIMUM_AUTO_INTERVAL = 5000;

const defaultSettings = {
    chatDisplayName: 'You',
    subreddit: 'all',
    autoInterval: '0',
    fetchPostsCount: '200',
    maxTextLength: '256'
};

var lastAutoTime = new Date().getTime();

function loadSettings() {

    if (!extension_settings.hasOwnProperty('reddit')) {
        extension_settings.reddit = {};
    }

    if (Object.keys(extension_settings.reddit).length === 0) {
        Object.assign(extension_settings.reddit, defaultSettings);
    }
    
    $('#chat_display_name').val(extension_settings.reddit.chatDisplayName).trigger('input');
    $('#reddit_subreddit').val(extension_settings.reddit.subreddit).trigger('input');
    $('#reddit_auto_interval').val(extension_settings.reddit.autoInterval).trigger('input');
    $('#reddit_fetch_posts_count').val(extension_settings.reddit.fetchPostsCount).trigger('input');
    $('#reddit_max_text_length').val(extension_settings.reddit.maxTextLength).trigger('input');
}

function onRedditChatDisplayNameInput() {
    const value = $(this).val();
    extension_settings.reddit.chatDisplayName = String(value);
    $('#chat_display_name').text(value);
    saveSettingsDebounced();
}

function onRedditSubredditInput() {
    const value = $(this).val();
    extension_settings.reddit.subreddit = String(value);
    $('#reddit_subreddit').text(value);
    saveSettingsDebounced();
}

function onRedditAutoIntervalInput() {
    const value = $(this).val();
    extension_settings.reddit.autoInterval = Number(value);
    $('#reddit_auto_interval').text(value);
    lastAutoTime = new Date().getTime() + MINIMUM_AUTO_INTERVAL;
    saveSettingsDebounced();
}

function onRedditFetchPostsCountInput() {
    const value = $(this).val();
    extension_settings.reddit.fetchPostsCount = Number(value);
    $('#reddit_fetch_posts_count').text(value);
    saveSettingsDebounced();
}

function onRedditMaxTextLengthInput() {
    const value = $(this).val();
    extension_settings.reddit.maxTextLength = Number(value);
    $('#reddit_max_text_length').text(value);
    saveSettingsDebounced();
}

async function moduleWorker() {
    const context = getContext();

    context.onlineStatus === 'no_connection'
        ? $('#send_reddit').hide(200)
        : $('#send_reddit').show(200);
    
    var timeElapsed = new Date().getTime() - lastAutoTime;
    if (timeElapsed > (extension_settings.reddit.autoInterval * 1000)
        && extension_settings.reddit.autoInterval > 0
        && timeElapsed > MINIMUM_AUTO_INTERVAL) {
        sendChatMessage();
    }
}

async function setRedditIcon() {
    try {
        const sendButton = document.getElementById('send_reddit');
        sendButton.classList.add('fa-brands', 'fa-reddit');
        sendButton.classList.remove('fa-solid', 'fa-hourglass-half');
    }
    catch (error) {
        console.log(error);
    }
}

async function setSpinnerIcon() {
    try {
        const sendButton = document.getElementById('send_reddit');
        sendButton.classList.remove('fa-brands', 'fa-reddit');
        sendButton.classList.add('fa-solid', 'fa-hourglass-half');
    }
    catch (error) {
        console.log(error);
    }
}

async function getRandomRedditPost() {
    const fetchPostsCount = extension_settings.reddit.fetchPostsCount;
    const maxTextLength = extension_settings.reddit.maxTextLength;
    const subreddit = extension_settings.reddit.subreddit;
    const sortOptions = ['hot', 'rising'];
    const sort = sortOptions[Math.floor(Math.random() * sortOptions.length)];
    const redditURL = `https://www.reddit.com/r/${subreddit}/${sort}/.json?limit=${fetchPostsCount}`;

    try {
        const response = await fetch(redditURL);
        const data = await response.json();
        const posts = data.data.children.map(child => child.data);

        let filteredPosts = posts.filter(post => {
            const isImage = post.post_hint === 'image';
            const hasText = post.selftext && post.selftext.length <= maxTextLength && post.selftext.length > 0;
            return isImage || hasText;
        });

        if (filteredPosts.length < fetchPostsCount) {
            const nextRedditURL = `${redditURL}&after=${data.data.after}`;
            const nextPageResponse = await fetch(nextRedditURL);
            const nextPageData = await nextPageResponse.json();
            const nextPagePosts = nextPageData.data.children.map(child => child.data);
            const nextPageFilteredPosts = nextPagePosts.filter(post => {
                const isImage = post.post_hint === 'image';
                const hasText = post.selftext && post.selftext.length <= maxTextLength;
                return isImage || hasText;
            });
            filteredPosts = filteredPosts.concat(nextPageFilteredPosts);
        }

        if (filteredPosts.length === 0) {
            return null; // No posts found with text or images
        }

        const randomIndex = Math.floor(Math.random() * filteredPosts.length);
        const randomPost = filteredPosts[randomIndex];
        return { post: randomPost };
    } catch (error) {
          console.error('Error:', error);
          return null;
    }
}

async function loadImage(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer(); // Convert response to an ArrayBuffer
      const blob = new Blob([arrayBuffer], { type: response.headers.get('Content-Type') }); // Create a Blob object

      return blob; // Return the Blob object
    } catch (error) {
          console.error('Error:', error);
    }
}

async function sendCaptionedMessage(caption, image, subreddit, title, url) {
    const context = getContext();
    const messageText = `How about the post in ${subreddit} titled ${title}, a picture that contains ${caption}?`;
    const message = {
        name: extension_settings.reddit.chatDisplayName,
        force_avatar: "img/reddit.png",
        is_user: false,
        is_system: false,
        is_name: true,
        send_date: Date.now(),
        mes: messageText,
        extra: {
            image: image,
            title: caption,
        },
    };
    context.chat.push(message);
    context.addOneMessage(message);
    await context.generate();
}

async function captionImage(url, subreddit, title) {
    setSpinnerIcon();
    const file = await loadImage(url);

    if (!file) {
        setRedditIcon();
        return;
    }

    try {
        const base64Img = await getBase64Async(file);
        const url = new URL(getApiUrl());
        url.pathname = '/api/caption';

        const apiResult = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'bypass',
            },
            body: JSON.stringify({ image: base64Img.split(',')[1] })
        });

        if (apiResult.ok) {
            const data = await apiResult.json();
            const caption = data.caption;
            const imageToSave = data.thumbnail ? `data:image/jpeg;base64,${data.thumbnail}` : base64Img;
            await sendCaptionedMessage(caption.replace(/arafed/g, ""), imageToSave, subreddit, title, url);
        }
    }
    catch (error) {
        console.log(error);
    }
    finally {
        setRedditIcon();
    }
}

async function sendChatMessage() {

    if (is_send_press) {
        setTimeout(sendChatMessage, 1000);
        return;
    }

    setSpinnerIcon();
    lastAutoTime = new Date().getTime();
    try {
        const context = getContext();
    
        const getRedditPost = await getRandomRedditPost();
        const redditPost = getRedditPost.post;
        var messageText = "";

        if (redditPost.post_hint === "image") {
            captionImage(redditPost.url, redditPost.subreddit, redditPost.title);
            return;
        }
        else if (redditPost.title !== "" && redditPost.selftext.length > 0) {
                messageText = `How about the post in ${redditPost.subreddit} titled ${redditPost.title}, they say ${redditPost.selftext}`;
        }
        else if (redditPost.title !== "") {
                        messageText = `How about the post in ${redditPost.subreddit} titled ${redditPost.title}`;
        }
        else {
            return;
        }
    
        const message = {
            name: extension_settings.reddit.chatDisplayName,
            force_avatar: "img/reddit.png",
            is_user: false,
            is_system: false,
            is_name: true,
            send_date: Date.now(),
            mes: messageText,
        };
        context.chat.push(message);
        context.addOneMessage(message);
        await context.generate();
        setRedditIcon();
    }
    catch (error) {
        setRedditIcon();
        console.log(error);
    }
}

$(document).ready(function () {
    function addFontAwesomeBrands() {
        const head = document.getElementsByTagName('head')[0];
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'css/brands.css';
        head.appendChild(css);
    }
    function addRedditButton() {
        const sendButton = document.createElement('div');
        sendButton.id = 'send_reddit';
        sendButton.classList.add('fa-brands', 'fa-reddit');
        $(sendButton).hide();
        $(sendButton).on('click', () => sendChatMessage());
        $('#send_but_sheld').prepend(sendButton);
    }
    function addExtensionControls() {
        const settingsHtml = `
        <div id="reddit_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Reddit</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">

                    <label for="chat_display_name">Chat User Display Name:</label>
                    <input id="chat_display_name" type="text" class="text_pole" maxlength="64" value="${defaultSettings.chatDisplayName}"/>

                    <label for="reddit_subreddit">Subreddit:</label>
                    <input id="reddit_subreddit" type="text" class="text_pole" maxlength="64" value="${defaultSettings.subreddit}"/>

                    <label for="reddit_auto_interval">Auto-post Interval:</label>
                    <input id="reddit_auto_interval" type="text" class="text_pole" maxlength="6" value="${defaultSettings.autoInterval}"/>

                    <label for="reddit_fetch_posts_count">How many posts to fetch:</label>
                    <input id="reddit_fetch_posts_count" type="text" class="text_pole" maxlength="6" value="${defaultSettings.fetchPostsCount}"/>

                    <label for="reddit_max_text_length">Max post text length:</label>
                    <input id="reddit_max_text_length" type="text" class="text_pole" maxlength="6" value="${defaultSettings.maxTextLength}"/>

                </div>
            </div>
        </div>
        `;
        $('#extensions_settings').append(settingsHtml);
        $('#chat_display_name').on('click', onRedditChatDisplayNameInput);
        $('#reddit_subreddit').on('input', onRedditSubredditInput);
        $('#reddit_auto_interval').on('input', onRedditAutoIntervalInput);
        $('#reddit_fetch_posts_count').on('input', onRedditFetchPostsCountInput);
        $('#reddit_max_text_length').on('input', onRedditMaxTextLengthInput);
    }

    addExtensionControls();
    loadSettings();
    addFontAwesomeBrands()
    addRedditButton();
    setRedditIcon();
    moduleWorker();
    setInterval(moduleWorker, UPDATE_INTERVAL);
});