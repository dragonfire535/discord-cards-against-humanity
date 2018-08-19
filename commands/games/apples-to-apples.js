const { Command, Argument } = require('discord-akairo');
const { Collection, escapeMarkdown } = require('discord.js');
const { stripIndents } = require('common-tags');
const { shuffle } = require('../../util/Util');
const { awaitPlayers, createJoinLeaveCollector, createLeaderboardCollector } = require('../../util/Collectors');
const Player = require('../../structures/Player');
const Deck = require('../../structures/Deck');
const { greenCards, redCards } = require('../../assets/json/apples-to-apples');

module.exports = class ApplesToApplesCommand extends Command {
	constructor() {
		super('apples-to-apples', {
			aliases: ['apples-to-apples', 'a2a', 'a-to-a'],
			category: 'games',
			description: 'Compete to see who can come up with the best card to match an adjective.',
			channel: 'guild',
			clientPermissions: ['ADD_REACTIONS', 'READ_MESSAGE_HISTORY'],
			args: [
				{
					id: 'maxPts',
					prompt: {
						start: 'What amount of awesome points should determine the winner?',
						retry: 'You provided an invalid awesome points maximum. Please try again.'
					},
					type: Argument.range('integer', 1, 20, true)
				},
				{
					id: 'noMidJoin',
					match: 'flag',
					flag: ['--no-mid-join', '-nmj']
				},
				{
					id: 'bot',
					match: 'flag',
					flag: ['--bot', '--rando', '-b']
				}
			]
		});
	}

	async exec(msg, { maxPts, noMidJoin, bot }) { // eslint-disable-line complexity
		if (this.client.playing.has(msg.channel.id)) return msg.util.reply('Only one game may be occurring per channel.');
		this.client.playing.add(msg.channel.id);
		let joinLeaveCollector = null;
		let leaderboardCollector = null;
		try {
			await msg.util.sendNew(
				`You will need at least ${bot ? 1 : 2} more player${bot ? '' : 's'}. To join, type \`join game\`.`
			);
			const awaitedPlayers = await awaitPlayers(msg, bot ? 9 : 10, bot ? 2 : 3);
			if (!awaitedPlayers) {
				this.client.playing.delete(msg.channel.id);
				return msg.util.sendNew('Game could not be started...');
			}
			const redDeck = new Deck(redCards);
			const greenDeck = new Deck(greenCards);
			const players = new Collection();
			for (const user of awaitedPlayers) {
				const player = new Player(user);
				player.dealHand(redDeck);
				players.set(player.id, player);
			}
			const czars = players.map(player => player.id);
			if (bot) {
				const player = new Player(this.client.user);
				player.dealHand(redDeck);
				players.set(player.id, player);
			}
			let winner = null;
			if (!noMidJoin) joinLeaveCollector = createJoinLeaveCollector(msg.channel, players, czars, redDeck);
			leaderboardCollector = createLeaderboardCollector(msg.channel, players);
			while (!winner) {
				czars.push(czars[0]);
				czars.shift();
				for (const player of players) {
					if (player.kickable) player.kick(players, czars);
				}
				if (players.size < 3) {
					await msg.util.sendNew('Oh... It looks like everyone left...');
					break;
				}
				const czar = players.get(czars[0]);
				const green = greenDeck.draw();
				await msg.util.sendNew(stripIndents`
					The card czar will be ${czar.user}!
					The Green Card is: **${escapeMarkdown(green.text)}**

					Sending DMs...
				`);
				const chosenCards = [];
				const turns = await Promise.all(
					players.map(player => player.turn(msg.channel, czar, green, redDeck, chosenCards))
				);
				const extra = turns.reduce((a, b) => a + b);
				if (!chosenCards.length) {
					await msg.util.sendNew('Hmm... No one even tried.');
					continue;
				}
				const cards = shuffle(chosenCards);
				await msg.util.sendNew(stripIndents`
					${czar.user}, which card${green.pick > 1 ? 's' : ''} do you pick?
					**Green Card**: ${escapeMarkdown(green.text)}

					${cards.map((card, i) => `**${i + 1}.** ${card.cards.join(', ')}`).join('\n')}
				`);
				const filter = res => {
					if (res.author.id !== czar.user.id) return false;
					if (!/^[0-9]+$/g.test(res.content)) return false;
					if (!cards[Number.parseInt(res.content, 10) - 1]) return false;
					return true;
				};
				const chosen = await msg.channel.awaitMessages(filter, {
					max: 1,
					time: 120000
				});
				if (!chosen.size) {
					await msg.util.sendNew('Hmm... No one wins. Dealing back cards...');
					for (const pick of cards) {
						for (const card of pick.cards) players.get(pick.id).hand.add(card);
					}
					players.get(czar.id).strikes++;
					continue;
				}
				const player = players.get(cards[Number.parseInt(chosen.first().content, 10) - 1].id);
				if (!player) {
					await msg.util.sendNew('Oh no, I think that player left! No awesome points will be awarded...');
					continue;
				}
				player.points += 1 + extra;
				if (player.points >= maxPts) {
					winner = player.user;
				} else {
					const addS = player.points > 1 ? 's' : '';
					await msg.util.sendNew(`Nice, ${player.user}! You now have **${player.points}** awesome point${addS}!`);
				}
			}
			if (joinLeaveCollector) joinLeaveCollector.stop();
			if (leaderboardCollector) leaderboardCollector.stop();
			this.client.playing.delete(msg.channel.id);
			if (!winner) return msg.util.sendNew('See you next time!');
			return msg.util.sendNew(`And the winner is... ${winner}! Great job!`);
		} catch (err) {
			this.client.playing.delete(msg.channel.id);
			if (joinLeaveCollector) joinLeaveCollector.stop();
			if (leaderboardCollector) leaderboardCollector.stop();
			return msg.util.reply(`Oh no, an error occurred: \`${err.message}\`. Try again later!`);
		}
	}
};
