module ApplicationCable
  # Connections are anonymous. A room code is the only credential this game has,
  # and it is deliberately short-lived and low-stakes: the worst an attacker can
  # do with a guessed code is watch or disrupt one friendly match. Introducing
  # accounts to protect that would cost far more than it is worth.
  #
  # What we do keep is a per-connection identifier, so `MatchChannel` can tell
  # the two peers in a room apart and the logs are readable.
  class Connection < ActionCable::Connection::Base
    identified_by :connection_id

    def connect
      self.connection_id = request.session&.id&.to_s || SecureRandom.uuid
    end
  end
end
