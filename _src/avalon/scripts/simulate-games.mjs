import { runSimulationSeries } from '../src/sim/GameSimulator.js';

function parseArgs(argv) {
  const options = {
    iterations: 100,
    assert: false,
    playerCounts: [5, 6, 7, 8, 9, 10],
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--iterations') {
      options.iterations = Number(argv[index + 1] || options.iterations);
      index += 1;
      continue;
    }

    if (arg === '--players') {
      options.playerCounts = (argv[index + 1] || '')
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isInteger(value) && value >= 5 && value <= 10);
      index += 1;
      continue;
    }

    if (arg === '--assert') {
      options.assert = true;
    }
  }

  return options;
}

function formatReasons(winReasons) {
  return Object.entries(winReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(' | ');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const summaries = runSimulationSeries({
    playerCounts: options.playerCounts,
    iterations: options.iterations,
  });

  console.log(`Simulated ${options.iterations} games per player count`);
  console.log('');

  for (const summary of summaries) {
    console.log(
      `${summary.playerCount}p  good=${summary.winners.good}  evil=${summary.winners.evil}` +
      `  avgTurns=${summary.averageTurns}  assassination=${summary.assassinationGames}`
    );
    console.log(`    ${formatReasons(summary.winReasons)}`);
  }

  if (!options.assert) {
    return;
  }

  for (const summary of summaries) {
    if (summary.totalGames !== options.iterations) {
      throw new Error(`${summary.playerCount}p: expected ${options.iterations} games`);
    }
    if (summary.winners.good + summary.winners.evil !== summary.totalGames) {
      throw new Error(`${summary.playerCount}p: winner counts do not match total games`);
    }
    if (summary.averageTurns <= 0) {
      throw new Error(`${summary.playerCount}p: average turn count is invalid`);
    }
  }
}

main();
