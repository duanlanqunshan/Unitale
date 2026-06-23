# Unitale AI Audiobook Maker
> 语言切换 / Language Switch: [中文版](README.md) | [English](README_en.md)
> 
[![](https://img.shields.io/badge/Author-sdsds222-orange.svg)](https://gitee.com/wangjiabin-x/uh5)
[![license](https://img.shields.io/github/license/elemefe/vue-amap.svg?style=flat-square)](https://github.com/sdsds222)
![GitHub](https://img.shields.io/badge/dynamic/json?logo=github&label=GitHub+Followers&labelColor=282c34&color=181717&query=%24.data.totalSubs&url=https%3A%2F%2Fapi.spencerwoo.com%2Fsubstats%2F%3Fsource%3Dgithub%26queryKey%3Dsdsds222&longCache=true)
[![Bilibili](https://img.shields.io/badge/dynamic/json?logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAD7ElEQVR4nO2dW9WrMBCFK6ESkFAJSKiESqgEHCABCZWAhEpAAhL2ecik5dDc%2FpXLBDLfWnlqy0xmJ5BMQnq5CIIgCIIgCIIgCIIgCEIBAHQAemYfrgCunD6wAKAHsEKxALgx+bCQD8%2FS9tmgVqeDr1lLigDgZvDhXso+K9TyTBQRwRJ8AHjntl0Flh5QRAQK%2FmKxPeayWx2OXpBNBKiHvi34b7T2MC4pAvW6twR%2FRwkRKPizBN8CgEcuESj4Lwm+BwBjahEk+H8EwJRKhOaCDzW8e1JLfkUUH1NgmR3XmHffHR1l+72BSs8d7w8U+JDAnZERQMcV+CtUi7dNqFqibB4J7vtrq7xKCuAasbTMXCL4T+5aVk6+2xHUrWdhruAR6HIJcOeu2UHI8zyAe2ytWfEdWz9PVvQ8YAmIQ5dDAB9LFsMVAv8oMO2zAGrC5WNIarRiAuKR9jYEd9pY08aa6uUzIHGRdkgKd8pY0yc1WjEBAqypDYoAG0QAZkQAZkQAZkQAZk4vANQenjsSzS3I%2FwcSbXU5jQBUkRtdf4Rar90v8kSv3+I3ffCCSpk8I%2Fw+lgDkdI%2Fv2rEp2CaiWm1AsDQLlDAD+dlFXLMeAaCSeLZdaSFE5VUQNot38cKuEeBgAsSuG0flVZBmEanbXfNQAsS0fgBYIn2fIu3%2FBBMHEyBmDXlFfA8IzeHb+Ems4WAChKykrVA9ZfsQTL57jXzRg4A5wC%2FA8N4ADiZAZwm2XjW75Qh2KOTfA0p4kygPw28OJcCVgn3nDnYo2EwEYRgGH0qAMyICMCMCMCMCMCMCMCMCMCfP3qwHDOQ4AAUekTk8FaBRihJnZdYbvtCGC7LvmkM63GjVDINPFrQgCq5ETXfmMzI90FXzPvfqt7x4rEu%2FZaEcCUxFvgz2zO+BUn6UkoaEEAsptiMSX5e8FoRYCN7cVgb4Vq7U%2FH50Pq4JNP7Qiw8UFnJwcK+tXy+Wj6PLEvPgHSHv5UgwA1IQIwwyFAyLJin9RoxYgAzAQIkPwNmf26busC+OIx5TDqo5nDT+F%2FSS%2F9CYzwb+No49zNy2evkYv0LywGGAXUvp6eSneycqOic0w20k7CNgKE7jJunSGLACTCxF27ylmQc98T5MQUH49swd+I0HPXslLKnT0N+wnkrTKi9JZL%2FL9i1SorMmdeQ4TQQ7OFMxIMzGD45w8nUL1im7efENZLJpgPSw0pfz0cdt4U3230Td%2FTvx2R6d2FrHhEWLkq5PELOMsRPHCPnAZGv1xJteL7jbJiaW3sB2nDvPC%2FosSYvjRQz4cJ6n7KO3rYQL7M+L6nVtfDVRAEQRAEQRAEIZ5%2FSAXmdfXaoQsAAAAASUVORK5CYII%3D&label=bilibili+fans&labelColor=FE7398&color=282c34&query=%24.data.totalSubs&url=https%3A%2F%2Fapi.spencerwoo.com%2Fsubstats%2F%3Fsource%3Dbilibili%26queryKey%3D11354448&longCache=true)](https://space.bilibili.com/11354448)


An AI Agent audiobook maker based on IndexTTS and Qwen3TTS. It uses an LLM to split scripts and detect emotions. It supports voice synthesis for many characters, can analyze voice styles, and can use the Qwen3TTS voice design model to create reference voices from voice descriptions. It also supports SFX, BGM mixing, and automatic matching of real time audio filters for dialogue. You can export the final WAV file directly in the browser. The tool itself needs no setup and can be used across platforms in a browser.

Background image prompt generation is now supported. You can export an MP4 video with story background images and story audio in one click.

Software Effect demonstration on Youtube: https://youtu.be/ePZf6-788xc

Please watch the tutorial first: https://www.bilibili.com/video/BV1KSzWByEy7

Smart voice synthesis demo: https://www.bilibili.com/video/BV1Nvc7zjEd1

The interface is clean and easy to use. It can generate audio in one click, and you can fine tune the generated audio.

![Main interface screenshot](界面图2.png)

### Online tool page (you need to set your own LLM and cloud native TTS project URL):

https://sdsds222.github.io/Unitale/

Version 1.5 update: LLM analysis can now create background image prompts and keep the same character features across different images. Copy the image prompts into another image generation model, then save the images into the background image blocks. After that, you can export an MP4 video with background images that match the story and with the story audio.

Automatic voice analysis and generation are now supported. The LLM analyzes the story, creates voice description text for each character, and then uses Qwen3TTS to generate reference audio from that description.

Initial asset pack, including voices, SFX, BGM, and other assets:

Please unzip it before importing the project. Download link: https://wwazp.lanzouw.com/i9S4t3ihazba

You can also download the initial project file from this repository directly, if your network speed allows it.

### Free cloud native IndexTTS 2 project:
Latest: https://cnb.cool/ConyStudio/IndexTTS2-Qwen3VoiceDesign

~~Old version: https://cnb.cool/ConyStudio/index-tts-v2~~

After you fork the cloud native repository, you can click the button to start online deployment. When it starts, enter the IP address from the project port into the TTS settings page in the front end, and the tool can call it.

For local deployment, use the old CNB project. First set up a local IndexTTS2 model based on the official version. Then put the api.py script from the old CNB project in the same folder as webui.py. Start api.py with uv, and this tool can call it. The Qwen3TTS voice design feature is not available in this mode.

The resource scheduling script lets two models run in the same cloud native project.

Bilibili generation demo videos:

https://www.bilibili.com/video/BV1qjF1zuEc5/

https://www.bilibili.com/video/BV1GpF1zNEXm/

https://www.bilibili.com/video/BV1AkzLB7E8M

https://www.bilibili.com/video/BV1v2kjB5EKV

https://www.bilibili.com/video/BV1jYkGBqEkL





### LLM uses the OpenAI compatible API
The LLM can use any model that supports the OpenAI compatible API.

In my tests, I used the Gemini OpenAI compatible API. Enter this Base URL: https://generativelanguage.googleapis.com/v1beta/openai and your API key to finish the setup.


### Audio asset pack
Download link. Please unzip it before importing the project: https://wwazp.lanzouw.com/i9S4t3ihazba

You can click the save project button in the editor to save all voice, SFX, BGM, filter, and script workspace data. Remember to save often. If the page is cleared, you can restore all work from the saved project file.

Beginners can start with the prepared initial project pack. It includes basic voices, SFX, and BGM. In this project folder, the file is named Unitale工程文件.json.

![Main interface screenshot](界面图1.png)

## Core Features:

This is a custom AI audiobook story workspace. It uses an LLM to understand novel text deeply, then handles automatic SFX insertion, BGM switching, scene filter setup, and emotional performance for many characters. You can generate a voiced audio work in the browser with one click.

AI voice generation: It can analyze text, create voice descriptions for characters, and use the Qwen3TTS voice design model to generate matching reference audio.

AI SFX arrangement: The system can understand actions and the mood of a scene, find matching sound effects from the local asset library, and place them at the right time during spoken dialogue. You do not need to align tracks by hand.

AI dynamic music: The AI analyzes changes in emotion and story turns in real time. It decides when to start, stop, and switch BGM, so the music follows the story.

AI scene aware filters: The system detects special dialogue scenes, such as phone calls, inner thoughts, underwater dialogue, and radio messages. It then adds real time audio filters to the matching lines to create a more natural sound.

Deep emotion and character performance: It splits novel paragraphs, separates narration from different characters, and uses context to infer emotion strength. It creates emotion prompts to guide TTS and produce more expressive voice acting.


![Main interface screenshot](Snipaste_2026-01-20_05-40-53.png)


The audio library is empty by default. You can import the JSON project save file from the project folder to load the audio library, or fill it in by hand using the settings shown in the screenshots below:

SFX scene sound library:

![Main interface screenshot](sfx1.png)

![Main interface screenshot](sfx2.png)

![Main interface screenshot](sfx3.png)

BGM music library:

![Main interface screenshot](BGM.png)

## Localization and Export:

Supports exporting and importing project files (.json) to save all editing states.

Highly configurable: custom Prompt templates, emotion presets, voice library, and sound effect library.
