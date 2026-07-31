module Api
  # Aggregate record per character, derived from stored match results.
  class LadderController < ApplicationController
    def index
      render json: Match.ladder
    end
  end
end
