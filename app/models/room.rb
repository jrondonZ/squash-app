# A two-player room, identified by a short code that is easy to read aloud.
#
# The server does not simulate the match. Its only jobs are to hand out a code,
# agree a shared seed so both browsers build an identical simulation, and give
# the two peers a channel to talk over.
class Room < ApplicationRecord
  has_many :matches, dependent: :nullify

  STATUSES = %w[waiting ready playing finished].freeze

  # Ambiguous glyphs are excluded: a code gets read out loud or typed from a
  # screenshot, and nobody should have to guess between O and 0 or I and 1.
  CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars.freeze
  CODE_LENGTH = 4

  # A room nobody has touched for this long is dead and can be reaped.
  STALE_AFTER = 2.hours

  validates :code, presence: true, uniqueness: true
  validates :host_name, :host_character, :seed, presence: true
  validates :status, inclusion: { in: STATUSES }

  scope :joinable, -> { where(status: "waiting").where(created_at: STALE_AFTER.ago..) }
  scope :stale, -> { where(updated_at: ...STALE_AFTER.ago) }

  before_validation :assign_code, on: :create
  before_validation :assign_seed, on: :create

  def self.open!(host_name:, host_character:)
    create!(host_name: host_name.to_s.strip.presence || "Player 1", host_character:)
  end

  def join!(guest_name:, guest_character:)
    raise AlreadyFull if full?

    update!(
      guest_name: guest_name.to_s.strip.presence || "Player 2",
      guest_character:,
      status: "ready",
      last_seen_at: Time.current
    )
    self
  end

  def full?
    guest_name.present?
  end

  def stream_name
    "match:#{code}"
  end

  def as_json(*)
    {
      code:,
      hostName: host_name,
      guestName: guest_name,
      hostCharacter: host_character,
      guestCharacter: guest_character,
      seed:,
      status:
    }
  end

  class AlreadyFull < StandardError; end

  private

  def assign_code
    return if code.present?

    # Retry on collision rather than trusting a single draw. The alphabet gives
    # ~1M codes, which is plenty concurrently but not enough to ignore birthday
    # collisions over the life of the table.
    10.times do
      candidate = Array.new(CODE_LENGTH) { CODE_ALPHABET.sample }.join
      next if Room.exists?(code: candidate)

      self.code = candidate
      break
    end

    self.code ||= SecureRandom.alphanumeric(6).upcase
  end

  def assign_seed
    # Both browsers seed their simulation from this, which is what makes the
    # deterministic engine produce the same match on both machines.
    self.seed ||= SecureRandom.hex(8)
  end
end
