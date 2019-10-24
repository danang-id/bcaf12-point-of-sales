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

import { Controller, Get, Post, Req } from '@tsed/common';
import { Docs } from '@tsed/swagger';
import { BadRequest, NotFound } from 'ts-httpexceptions';
import { EntityManager } from 'typeorm';
import { compareSync, hashSync } from 'bcrypt';
import { sign } from 'jsonwebtoken';
import SendGridMail from '@sendgrid/mail';

import { DatabaseService } from '../services/DatabaseService';
import { ValidateRequest } from '../decorators/ValidateRequestDecorator';
import { User } from '../model/User';
import { PassportConfig } from '../config/passport.config';
import { ServerConfig } from '../config/server.config';
import { Token } from '../model/Token';

;

@Controller('/')
@Docs('api-v1')
export class AuthenticationController {

	private manager: EntityManager;

	constructor(private databaseService: DatabaseService) {}

	public $afterRoutesInit(): void {
		this.manager = this.databaseService.getManager();
	}

	@Post('/sign-in')
	@ValidateRequest({
		body: ['email_address', 'password'],
		useTrim: true
	})
	public async signIn(@Req() request: Req): Promise<{ token: string }> {
		const body = {
			email_address: request.body.email_address,
			password: request.body.password
		};
		const user = await this.manager.findOne(User, {
			email_address: body.email_address
		});
		if (typeof user === 'undefined') {
			throw new BadRequest('Sign in failed! Please check your email address or password.');
		}
		if (compareSync(body.password, user.password)) {
			throw new BadRequest('Sign in failed! Please check your email address or password.');
		}
		const { password, ...payload } = user;
		const token = sign(payload, PassportConfig.jwt.secret);
		return { token };
	}

	@Post('/register')
	@ValidateRequest({
		body: ['given_name', 'maiden_name', 'email_address', 'password', 'password_confirmation'],
		useTrim: true
	})
	public async register(@Req() request: Req): Promise<string> {
		const body = {
			given_name: request.body.given_name,
			maiden_name: request.body.maiden_name,
			email_address: request.body.email_address,
			password: request.body.password,
			password_confirmation: request.body.password_confirmation
		};
		try {
			await this.databaseService.startTransaction()
			const emailRegExp = new RegExp(
				/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
			);
			if (!emailRegExp.test(body.email_address)) {
				throw new BadRequest('Registration failed. Email address "' + body.email_address + '" is not a valid email address.')
			}
			let user = await this.manager.findOne(User, {
				email_address: body.email_address
			});
			if (typeof user !== 'undefined') {
				throw new BadRequest('User with email address ' + body.email_address + ' is already registered.');
			}
			if (body.password !== body.password_confirmation) {
				throw new BadRequest('Your password did not match confirmation.');
			}
			user = new User();
			user.given_name = body.given_name;
			user.maiden_name = body.maiden_name;
			user.email_address = body.email_address;
			user.password = hashSync(body.password, 10);
			user = await this.manager.save(user);
			let token = new Token();
			token.user_id = user._id;
			token = await this.manager.save(token);
			const activationLink = ServerConfig.baseURL + `activate?email_address=${user.email_address}&token=${token._id}`
			const message = {
				to: user.email_address,
				from: 'noreply@mycashier.pw',
				subject: 'Active your MyCashier account!',
				html: `
<div>
	Hi, ${user.given_name}!<br /><br />
	Welcome to MyCashier! Please active your account by clicking on this link: <a href="${activationLink}">${activationLink}</a><br /><br />
	Regards,<br />
	MyCashier Operation Team
</div>
`,
			};
			await SendGridMail.send(message);
			await this.databaseService.commit()
			return 'You are successfully registered. Please check your email inbox to activate your account.';
		} catch (error) {
			await this.databaseService.rollback();
			throw error;
		}
	}

	@Post('/activate')
	@ValidateRequest({
		body: ['email_address', 'token'],
		useTrim: true
	})
	public async activate(@Req() request: Req): Promise<string> {
		const body = {
			email_address: request.body.email_address,
			token: request.body.token
		};
		try {
			await this.databaseService.startTransaction();
			let user = await this.manager.findOne(User, {
				email_address: body.email_address
			});
			if (typeof user === 'undefined') {
				throw new BadRequest('There is no account registered with email address ' + body.email_address + '.');
			}
			let token = await this.manager.findOne(Token, body.token);
			if (typeof token === 'undefined' || token.user_id !== user._id) {
				throw new BadRequest('Your activation token is invalid. Please re-check your activation link!');
			}
			user.is_activated = true;
			user = await this.manager.save(user);
			await this.manager.remove(Token, token);
			const message = {
				to: user.email_address,
				from: 'noreply@mycashier.pw',
				subject: 'Welcome to MyCashier!',
				html: `
<div>
	Hi, ${user.given_name}!<br /><br />
	Welcome to MyCashier! Your account has been successfully activated. You now may sign in to enjoy our services.<br /><br />
	Regards,<br />
	MyCashier Operation Team
</div>
`,
			};
			await SendGridMail.send(message);
			await this.databaseService.commit()
			return 'Your account has been successfully activated. You now may sign in to enjoy our services.';
		} catch (error) {
			await this.databaseService.rollback();
			throw error;
		}
	}

	@Post('/forget-password')
	@ValidateRequest({
		body: ['email_address'],
		useTrim: true
	})
	public async forgetPassword(@Req() request: Req): Promise<string> {
		const body = {
			email_address: request.body.email_address,
		};
		try {
			await this.databaseService.startTransaction()
			let user = await this.manager.findOne(User, {
				email_address: body.email_address
			});
			if (typeof user === 'undefined') {
				throw new BadRequest('There is no account registered with email address ' + body.email_address + '.');
			}
			let token = new Token();
			token.user_id = user._id;
			token = await this.manager.save(token);
			const recoverLink = ServerConfig.baseURL + `activate?email_address=${user.email_address}&token=${token._id}`
			const message = {
				to: user.email_address,
				from: 'noreply@mycashier.pw',
				subject: 'Recover your MyCashier account',
				html: `
<div>
	Hi, ${user.given_name}!<br /><br />
	To recover your MyCashier account, please click this link: <a href="${recoverLink}">${recoverLink}</a><br /><br />
	Regards,<br />
	MyCashier Operation Team
</div>
`,
			};
			await SendGridMail.send(message);
			await this.databaseService.commit()
			return 'A recovery email has been sent to your email address. Please check your email inbox to recover your account.';
		} catch (error) {
			await this.databaseService.rollback();
			throw error;
		}
	}


	@Post('/recover')
	@ValidateRequest({
		body: ['email_address', 'token', 'password', 'password_confirmation'],
		useTrim: true
	})
	public async recover(@Req() request: Req): Promise<string> {
		const body = {
			email_address: request.body.email_address,
			token: request.body.token,
			password: request.body.password,
			password_confirmation: request.body.password_confirmation
		};
		try {
			await this.databaseService.startTransaction();
			let user = await this.manager.findOne(User, {
				email_address: body.email_address
			});
			if (typeof user === 'undefined') {
				throw new BadRequest('There is no account registered with email address ' + body.email_address + '.');
			}
			let token = await this.manager.findOne(Token, body.token);
			if (typeof token === 'undefined' || token.user_id !== user._id) {
				throw new BadRequest('Your recovery token is invalid. Please re-check your activation link!');
			}
			if (body.password !== body.password_confirmation) {
				throw new BadRequest('Your password did not match confirmation.');
			}
			user.password = hashSync(body.password, 10);
			user = await this.manager.save(user);
			await this.manager.remove(Token, token);
			await this.databaseService.commit()
			return 'Your account has been successfully recovered. You now may sign in with newly created passwords.';
		} catch (error) {
			await this.databaseService.rollback();
			throw error;
		}
	}

}