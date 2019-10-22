/**
 * Copyright 2019, Danang Galuh Tegar Prasetyo.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import "@babel/polyfill";
import http from "http";
import express from "express";
import cors from "cors";
import { json, urlencoded } from "body-parser";
import helmet from "helmet";

import Controllers from "./controller";
import Services from "./services";
import { createErrorHandler, createRouter, showLog } from "./helpers/express";
import { createLogger } from "./helpers/logger";
import { JWTConfig } from "./config/jwt.config";

const app = express();
const router = createRouter(app);
const logger = createLogger("Application");
const server = new http.Server(app);
const port = process.env.PORT || 9000;
const unprotectedEndpoints: string[] = [];
const errorHandler = createErrorHandler(logger);

app.use(helmet());
app.use(json());
app.use(urlencoded({ extended: true }));
app.use(cors());
app.use(showLog(logger));

for (const key in Services) {
	if (Services.hasOwnProperty(key)) {
		const service = Services[key];
		let protectionString = ".";
		if (JWTConfig.isActive) {
			if (!service.useAuth) {
				unprotectedEndpoints.push(service.endpoint);
			} else {
				protectionString = " [PROTECTED]".concat(protectionString);
			}
		} else {
			service.useAuth = false;
		}
		logger.i("Added " + key + " service on endpoint " + service.method + " " + service.endpoint + protectionString);
		(<{ [k: string]: any }>router)[service.method.toLowerCase()](service.endpoint, service.useAuth)
			.handle(Controllers[service.handler]);
	}
}

logger.i("Added Main service to endpoint *.");
app.use(Controllers.serve);
app.use(errorHandler);

server.listen(port, function () {
	logger.i("Server listening http://localhost:" + port + ".");
});

export default app;
