# Online-CABO
A web-based multiplayer card game inspired by the classic "Cabo". Where Players must memorize hidden cards, use special abilities, and strategically swap or reveal cards to finish rounds and aim with the lowest total score. This App was built as part of the Software Engineering Lab course (SoPra FS26) at the University of Zurich.

## Introduction
Goal: Provide a secure, stateful multiplayer backend for Cabo-style rounds—lobbies, live game state, moves, scoring, rematch, friends, and session history—so the web client can stay thin and event-driven.

Motivation: Cabo relies on hidden information, timed phases, and synchronized updates between players. A dedicated server enforces rules, persists session data, and broadcasts changes over WebSockets to clients.



## Getting Started
With the following instructions will get a copy of the project up and running on the local machine. Note: 
The frontend requires the Spring Boot backend to be running at the same time. Please ensure the backend server is running before starting with the frontend. The API URLs are configured in `app/utils/domain.ts`.

### Prerequisites
The following software has to already be installed:
```
Node.js (v18 or higher)
npm (v9 or higher)
Git
```
### Installing
Clone the folowing repository:
```
git clone https://github.com/liun777/sopra-fs26-group-26-client.git
cd sopra-fs26-group-26-client
```
Install dependencies:
```
npm install
```
Start the development server:

```
npm run dev
```
The app will then be running at:
```
http://localhost:3000
```

## Running the Tests
### Prodution Build Check
To make sure that the production build compiles without errors (mirrors what Vercel runs on deployment) run the following command in the terminal:
```
npm run build
```
## Deployment
This appl is deployed on **Vercel**. A push to the main-branch triggers the deployment automatically.
To deploy manually:
```
npm run build
npm run start
```
For containerized deployment, a Dockerfile is provided. Build and run this with the following comman:
```
docker build -t cabo-client .
docker run -p 3000:3000 cabo-client
```
The environment variables for the backend API URL are configured in `app/utils/domain.ts`.

## Built With
* [Next.js](https://nextjs.org/) - React framework for routing and rendering
* [React](https://reactjs.org/) - Component-based frontend library
* [TypeScript](https://www.typescriptlang.org/) - Strongly typed JavaScript
* [Ant Design](https://ant.design/) - User Interface component library
* [SockJS](https://github.com/sockjs/sockjs-client) + [STOMP.js](https://stomp-js.github.io/stomp-websocket/) - Real-time WebSocket communication
* [Vercel](https://vercel.com/) - Frontend deployment platform

## API overview
WebSocket STOMP setup: WebSocketConfig.java.



## Roadmap
Top ideas for new contributors:
- AI/bot players for single-player practice mode with different difficulty levels
- Enhanced mobile responsiveness 
- Full spectator mode with live card visibility

## Authors
* **Alexandra Gort** - Frontend - [@aleexgort](https://github.com/aleexgort)
* **Liun Grichting** - Backend - [@liun777](https://github.com/liun777)
* **Jana Graf** - Backend - [@janagraf](https://github.com/janagraf)
* **Jan Alexander Studenski** - Frontend - [@suisu-IT-daigakusei](https://github.com/suisu-IT-daigakusei)
* **Uliana Solohub** - Backend - [@uIiana](https://github.com/uIiana)

See also the list of [contributors](https://github.com/liun777/sopra-fs26-group-26-client/graphs/contributors) who participated in this project.

## Acknowledgments
* Thomas Fritz, Prof. Dr. (course teacher) and the SoPra FS26 teaching assistants at the University of Zurich
* The original Cabo card game for the game design inspiration
* Open-source contributors of all libraries used in this project








