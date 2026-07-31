# A completed match result.
#
# Every number here was produced by the browser's simulation. The server takes
# it on trust, which is the right trade for a friendly game — and the reason
# the ladder is presented as a record of play rather than a competitive ranking.
class Match < ApplicationRecord
  belongs_to :room, optional: true

  validates :player_one, :player_two, :character_one, :character_two, presence: true
  validates :winner, inclusion: { in: [ 0, 1 ] }
  validates :games_one, :games_two,
            numericality: { only_integer: true, in: 0..3 }
  validates :duration_seconds, :total_rallies, :longest_rally,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  validate :winner_must_have_won_more_games
  validate :game_scores_must_be_legal

  scope :recent, ->(limit = 20) { order(created_at: :desc).limit(limit) }

  def winner_character
    winner.zero? ? character_one : character_two
  end

  def loser_character
    winner.zero? ? character_two : character_one
  end

  def scoreline
    game_scores.map { |game| game.join("-") }.join(", ")
  end

  def as_json(*)
    {
      id:,
      playerOne: player_one,
      playerTwo: player_two,
      characterOne: character_one,
      characterTwo: character_two,
      games: [ games_one, games_two ],
      gameScores: game_scores,
      winner:,
      durationSeconds: duration_seconds,
      totalRallies: total_rallies,
      longestRally: longest_rally,
      playedAt: created_at.iso8601
    }
  end

  # Aggregate record per character, used for the ladder screen.
  def self.ladder
    all.each_with_object(Hash.new { |h, k| h[k] = blank_entry(k) }) do |match, table|
      [ [ match.character_one, 0 ], [ match.character_two, 1 ] ].each do |character, side|
        entry = table[character]
        entry[:played] += 1
        entry[:won] += 1 if match.winner == side
        entry[:gamesWon] += side.zero? ? match.games_one : match.games_two
        entry[:gamesLost] += side.zero? ? match.games_two : match.games_one
      end
    end.values.map { |entry|
      entry.merge(winRate: entry[:played].zero? ? 0.0 : (entry[:won].to_f / entry[:played]).round(3))
    }.sort_by { |entry| [ -entry[:winRate], -entry[:played] ] }
  end

  def self.blank_entry(character)
    { characterId: character, played: 0, won: 0, gamesWon: 0, gamesLost: 0 }
  end
  private_class_method :blank_entry

  private

  def winner_must_have_won_more_games
    return if games_one == games_two # A concession or abandonment; allow it.

    leader = games_one > games_two ? 0 : 1
    return if leader == winner

    errors.add(:winner, "does not match the games won")
  end

  def game_scores_must_be_legal
    return if game_scores.blank?

    unless game_scores.is_a?(Array) && game_scores.all? { |g| g.is_a?(Array) && g.size == 2 }
      errors.add(:game_scores, "must be an array of two-element scores")
      return
    end

    # Point-a-rally to 11, win by two — so the winner of a game has at least 11
    # and leads by at least 2.
    game_scores.each_with_index do |(a, b), index|
      next if a.is_a?(Integer) && b.is_a?(Integer) &&
              [ a, b ].max >= 11 && ([ a, b ].max - [ a, b ].min) >= 2

      errors.add(:game_scores, "game #{index + 1} (#{a}-#{b}) is not a legal squash score")
    end
  end
end
