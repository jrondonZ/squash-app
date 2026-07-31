module Api
  # Match results, and the ladder derived from them.
  class MatchesController < ApplicationController
    rescue_from ActiveRecord::RecordInvalid, with: :unprocessable

    MAX_LIMIT = 100

    def index
      limit = params.fetch(:limit, 20).to_i.clamp(1, MAX_LIMIT)
      render json: Match.recent(limit)
    end

    def create
      match = Match.create!(match_params)
      render json: match, status: :created
    end

    private

    def match_params
      raw = params.require(:match)

      {
        player_one: raw[:playerOne],
        player_two: raw[:playerTwo],
        character_one: raw[:characterOne],
        character_two: raw[:characterTwo],
        games_one: raw.dig(:games, 0).to_i,
        games_two: raw.dig(:games, 1).to_i,
        game_scores: normalise_scores(raw[:gameScores]),
        winner: raw[:winner].to_i,
        duration_seconds: raw[:durationSeconds].to_i,
        total_rallies: raw[:totalRallies].to_i,
        longest_rally: raw[:longestRally].to_i
      }
    end

    # Params arrive as strings; the model validates them as integers.
    def normalise_scores(scores)
      Array(scores).filter_map do |game|
        pair = Array(game).first(2).map(&:to_i)
        pair if pair.size == 2
      end
    end

    def unprocessable(error)
      render json: { error: error.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end
end
