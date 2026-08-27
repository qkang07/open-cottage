*   Github:<https://github.com/qkang07/open-cottage>
*   Demo: <https://cottage.swimlions.com>
*   Doc: <https://doc.cottage.swimlions.com>

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/caf903452ad743e6bfd8927bd557856f~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=PAMc1DGqxUWUcd8cF5S5dalvXt0%3D)

This article introduces another new agent platform: Open Cottage. Amid the growing variety of agent platforms, Open Cottage is anything but ordinary. In short, it is a browser-based, frontend-only agent platform. It is not a desktop client, does not invoke a CLI, and has no backend—it runs entirely in the browser, yet can do far more than you might expect.

## How to Use It

Just open a web page to get started. The official demo link is included at the beginning of this article. You will need to provide your own API key for calling an LLM, however.

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/8003516b4505451d84166dc74acffa85~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=qg8PZmoZqZRDETYC%2Fg%2FozyyFRkQ%3D)

Although it is browser-based, you need to select a local folder as its workspace (this is currently required). Once you open a local folder through the browser, Open Cottage can read from and write to it freely. All chat history, file-change history, and even some preferences are stored in a `.cottage` directory inside the workspace. Apart from LLM API calls, all data and computation remain local.

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/c06762abb0ab4d65813bf56a1d1e2717~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=j9GrUNroMuPFd17GtqJAKJI6IcQ%3D)

## What It Can Do

### Write Code

Since it can edit files, it can of course write code. It can read your project directory, search it, and make edits automatically. It cannot execute system commands or debug for you, though—you will need to handle those yourself.

It is quite convenient for creating simple HTML, which you can preview directly.

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/818a4ef2a07d47b1826ec5030950a67e~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=mb1VkUKwyKEG%2B8czQx3hT7JkQpM%3D)

### Script Tasks

Even in the browser, it can run scripts: it generates a JavaScript script and runs it in a web worker.

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/39676135df8f4594a64315f3f86da2ca~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=S4pWGsntl6tdpXRrlf4%2BA4NHmy8%3D)

### More Capabilities

There are more capabilities than can be covered one by one here. In short, it provides the core features you would expect from a mainstream agent.

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/cbc352a4262c4cdbba24279817867e0c~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgcWthbmc=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjE5NTU4MDU4NjY3NzIwIn0%3D&rk3s=f64ab15b&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1788053436&x-orig-sign=fHRssUd%2BBx9pul6apBpMdn2NX0g%3D)

## What It Cannot Do

**1. Run local commands**
Because it runs only in the browser, it cannot execute CLI commands.

**2. Remote operation**
It cannot run on a remote server and perform tasks around the clock.

**3. Online synchronization**
It has no backend; all information is stored locally.

## That Is It for Now

Although this covers only a small part of it, it should be enough to give you a basic understanding of Open Cottage.

If you are interested, feel free to explore it yourself. I will continue to publish more articles about Open Cottage's capabilities and architecture.

The project has only just launched and been open-sourced, so there is still plenty to improve. You are welcome to try it out, share your feedback, or offer suggestions.
